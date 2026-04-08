import { readdir, readFile, stat } from "fs/promises";
import { join } from "path";
import { SESSIONS_DIR, PROJECTS_DIR } from "../lib/constants.js";
import { cwdToProjectDir } from "./pairing.js";
import { findTmuxSessionForPid, isTmuxPaneWaiting } from "./tmux.js";
import { getClaudeProcesses } from "./claude-process.js";
import { tailFile } from "./jsonl-parser.js";
import { findLatestJsonl, resolveJsonlForPid } from "./jsonl-resolver.js";
import type { Session, SessionContext, SessionStatus, ClaudeProcess } from "../schemas/session.js";

/**
 * Extract context from the last chunk of a JSONL file for a given session.
 * Returns snippet, last user message, slug, timestamps, and waiting state.
 */
export async function getSessionContext(
  cwd: string,
  sessionId: string,
): Promise<SessionContext | null> {
  const projectDir = cwdToProjectDir(cwd);

  // Try exact session ID match first, then fall back to most recent JSONL
  let jsonlPath = join(PROJECTS_DIR, projectDir, `${sessionId}.jsonl`);
  try {
    await stat(jsonlPath);
  } catch {
    const found = await findLatestJsonl(projectDir, cwd);
    if (!found) return null;
    jsonlPath = found;
  }

  const lines = await tailFile(jsonlPath, 65536);
  if (lines.length === 0) return null;

  let lastActivity: string | null = null;
  let lastUserMessage: string | null = null;
  let lastAssistantText: string | null = null;
  let lastToolName: string | null = null;
  let slug: string | null = null;
  let isWaitingForUser = false;

  // Parse lines from end to get the most recent context
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const line = lines[i];
      if (!line) continue;
      const entry = JSON.parse(line) as Record<string, unknown>;

      // Track the most recent timestamp
      if (typeof entry.timestamp === "string" && !lastActivity) {
        lastActivity = entry.timestamp;
      }

      // Grab slug from any entry
      if (typeof entry.slug === "string" && !slug) {
        slug = entry.slug;
      }

      // Detect "waiting for user" — turn_duration means Claude finished its turn
      if (
        entry.type === "system" &&
        entry.subtype === "turn_duration" &&
        i >= lines.length - 3
      ) {
        isWaitingForUser = true;
      }

      // Last assistant text message
      if (entry.type === "assistant" && !lastAssistantText) {
        const message = entry.message as Record<string, unknown> | undefined;
        const content = message?.content;
        if (Array.isArray(content)) {
          const textBlock = content.find(
            (c): c is Record<string, unknown> =>
              typeof c === "object" && c !== null && (c as Record<string, unknown>).type === "text",
          ) as Record<string, unknown> | undefined;
          if (textBlock && typeof textBlock.text === "string") {
            lastAssistantText = textBlock.text.slice(0, 200);
          }
          const toolBlock = content.find(
            (c): c is Record<string, unknown> =>
              typeof c === "object" && c !== null && (c as Record<string, unknown>).type === "tool_use",
          ) as Record<string, unknown> | undefined;
          if (toolBlock && typeof toolBlock.name === "string" && !lastToolName) {
            lastToolName = toolBlock.name;
          }
        }
      }

      // Last human-typed message — has promptId but no sourceToolAssistantUUID
      if (
        entry.type === "user" &&
        entry.promptId &&
        !entry.sourceToolAssistantUUID &&
        !lastUserMessage
      ) {
        const message = entry.message as Record<string, unknown> | undefined;
        const content = message?.content;
        if (typeof content === "string" && content.trim()) {
          lastUserMessage = content.slice(0, 200);
        } else if (Array.isArray(content)) {
          const textPart = content.find(
            (c): c is Record<string, unknown> =>
              typeof c === "object" && c !== null && (c as Record<string, unknown>).type === "text",
          ) as Record<string, unknown> | undefined;
          if (textPart && typeof textPart.text === "string") {
            lastUserMessage = textPart.text.slice(0, 200);
          }
        }
      }

      // Once we have enough context, stop
      if (lastActivity && (lastAssistantText || lastUserMessage) && slug) break;
    } catch {
      // skip malformed lines
    }
  }

  // Build a concise context snippet
  let snippet: string | null = null;
  if (lastAssistantText) {
    const firstLine = lastAssistantText.split("\n")[0] ?? "";
    snippet = firstLine.length > 120 ? firstLine.slice(0, 117) + "..." : firstLine;
  } else if (lastToolName) {
    snippet = `Using ${lastToolName}...`;
  }

  return {
    lastActivity: lastActivity ? new Date(lastActivity).getTime() : null,
    snippet,
    lastUserMessage: lastUserMessage
      ? (lastUserMessage.split("\n")[0] ?? "").slice(0, 120)
      : null,
    slug,
    isWaitingForUser,
  };
}

/**
 * Determine session status by combining process state, JSONL context, and tmux pane.
 */
export function inferStatus(
  proc: ClaudeProcess | undefined,
  context: SessionContext | null,
  tmuxSession: string | null,
): SessionStatus {
  if (!proc) return "dead";

  // High CPU = actively working right now
  if (proc.cpu > 5) return "working";

  // JSONL says Claude finished its turn
  if (context?.isWaitingForUser) return "waiting";

  // For tmux-managed sessions, check the pane content for the prompt
  if (tmuxSession && isTmuxPaneWaiting(tmuxSession)) return "waiting";

  // Check how stale the last activity is
  if (context?.lastActivity) {
    const idleMs = Date.now() - context.lastActivity;
    if (idleMs > 10 * 60 * 1000) return "idle";
  }

  // Default: if foreground process is sleeping, likely waiting
  if (proc.stat.includes("S+")) return "waiting";
  if (proc.stat.includes("R")) return "working";
  return "idle";
}

/** Status ordering for sort: waiting first, then working, then idle */
const STATUS_ORDER: Record<string, number> = {
  waiting: 0,
  working: 1,
  idle: 2,
  dead: 3,
};

/**
 * Read all session files and correlate with processes + JSONL context.
 * Returns sessions sorted by status priority then recency.
 */
export async function getSessions(): Promise<Session[]> {
  const processes = getClaudeProcesses();
  let files: string[];
  try {
    files = await readdir(SESSIONS_DIR);
  } catch {
    return [];
  }

  const sessions: Session[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(SESSIONS_DIR, file), "utf-8");
      const data = JSON.parse(raw) as Record<string, unknown>;
      const pid = data.pid as number;
      const proc = processes.get(pid);

      // Skip processes that aren't running
      if (!proc) continue;

      const cwd = (typeof data.cwd === "string" ? data.cwd : "unknown");
      const parts = cwd.split("/");
      const shortName = parts[parts.length - 1] || parts[parts.length - 2] || cwd;
      const sessionId = data.sessionId as string;

      // Resolve and cache JSONL path before anything else
      await resolveJsonlForPid(pid, cwd, sessionId);
      const context = await getSessionContext(cwd, sessionId);

      // Check if this session is in a ccboard-managed tmux session
      const tmuxSession = findTmuxSessionForPid(pid);

      // Skip supervisor sessions — they shouldn't appear in the sessions list
      if (tmuxSession && tmuxSession.includes("-sup-")) continue;

      const status = inferStatus(proc, context, tmuxSession);
      const startedAt = typeof data.startedAt === "number" ? data.startedAt : undefined;

      sessions.push({
        pid,
        sessionId,
        cwd,
        shortName,
        startedAt,
        lastActivity: context?.lastActivity ?? startedAt ?? 0,
        status,
        cpu: proc.cpu,
        tty: proc.tty,
        snippet: context?.snippet ?? null,
        lastUserMessage: context?.lastUserMessage ?? null,
        slug: context?.slug ?? null,
        managed: !!tmuxSession,
        tmuxSession: tmuxSession ?? null,
      });
    } catch {
      // skip corrupted files
    }
  }

  // Sort: waiting first, then working, then idle. Within same status, most recent first.
  sessions.sort((a, b) => {
    const statusDiff = (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3);
    if (statusDiff !== 0) return statusDiff;
    return b.lastActivity - a.lastActivity;
  });

  return sessions;
}
