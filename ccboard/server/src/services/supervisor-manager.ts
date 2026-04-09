/**
 * Supervisor lifecycle management: state tracking, review loop, reconnection.
 * Ported from server.js supervisor functions.
 */

import { execSync } from "child_process";
import { readFile, stat } from "fs/promises";
import { join } from "path";
import { CLAUDE_DIR, SESSIONS_DIR, PROJECTS_DIR, TMUX_PREFIX } from "../lib/constants.js";
import { createLogger } from "../lib/logger.js";
import {
  isTmuxPaneWaiting,
  sendToTmuxSession,
} from "./tmux.js";
import { cwdToProjectDir, readSessionPairing, updateSessionPairing } from "./pairing.js";
import { readFullConversation } from "./jsonl-parser.js";
import {
  extractActionTurns,
  isSupervisorNoise,
  extractHumanText,
} from "./action-extractor.js";
import { resolveJsonlForPid } from "./jsonl-resolver.js";
import { getSessions } from "./session-reader.js";
import type { Session } from "../schemas/session.js";
import type { JsonlUserEntry } from "../schemas/jsonl.js";
import type { ChatMessage } from "../schemas/api.js";

const log = createLogger("supervisor");

// ---------------------------------------------------------------------------
// Supervisor state
// ---------------------------------------------------------------------------

export interface SupervisorState {
  tmuxSession: string;
  stopped: boolean;
  jsonlPath: string | null;
  results: SupervisorResults | null;
  reviewing?: boolean;
  lastCommitHash?: string | null;
  lastJsonlMtime?: number;
  timeout?: ReturnType<typeof setTimeout>;
}

export interface SupervisorResults {
  summary?: string;
  review?: Record<string, ReviewCategoryResult>;
  reviewedAt?: number | string;
}

interface ReviewCategoryResult {
  status?: string;
  findings?: unknown[];
}

/** Active supervisors keyed by primary session PID */
export const supervisors = new Map<number, SupervisorState>();

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

/** Get current git HEAD commit hash */
export function getGitHead(cwd: string): string | null {
  try {
    return execSync("git rev-parse HEAD 2>/dev/null", {
      cwd,
      encoding: "utf-8",
    }).trim();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Review message builder
// ---------------------------------------------------------------------------

/** Build the review trigger message sent to the supervisor each cycle */
export async function buildReviewMessage(
  session: Session,
  sup: SupervisorState,
): Promise<string> {
  const parts: string[] = [];

  parts.push(`Project: ${session.shortName} (${session.cwd})`);

  // Collect ALL diffs -- committed since last review + uncommitted working tree
  let allDiffs = "";

  const currentHash = getGitHead(session.cwd);
  if (sup.lastCommitHash && currentHash && sup.lastCommitHash !== currentHash) {
    try {
      const committed = execSync(
        `git diff ${sup.lastCommitHash}..${currentHash}`,
        { cwd: session.cwd, encoding: "utf-8", timeout: 10000 },
      ).trim();
      if (committed) {
        allDiffs += `COMMITTED SINCE LAST REVIEW (${sup.lastCommitHash.slice(0, 7)}..${currentHash.slice(0, 7)}):\n${committed}\n\n`;
      }
    } catch {
      // diff may fail if commit is orphaned
    }
  }

  // Always include uncommitted changes (staged + unstaged)
  try {
    const uncommitted = execSync("git diff && git diff --staged", {
      cwd: session.cwd,
      encoding: "utf-8",
      timeout: 10000,
    }).trim();
    if (uncommitted) allDiffs += `UNCOMMITTED WORKING TREE CHANGES:\n${uncommitted}`;
  } catch {
    // ignore
  }

  if (!allDiffs.trim()) allDiffs = "No code changes detected.";
  allDiffs = allDiffs.slice(0, 10000);

  // Recent activity from JSONL
  let activityLog = "No recent activity.";
  if (sup.jsonlPath) {
    const entries = await readFullConversation(sup.jsonlPath);
    const turns = extractActionTurns(entries);
    const recentTurns = turns.slice(-5);
    const lines: string[] = [];
    for (const t of recentTurns) {
      if (isSupervisorNoise(t.humanMessage)) continue;
      const time = t.timestamp
        ? new Date(t.timestamp).toLocaleTimeString("en-GB")
        : "";
      lines.push(`[${time}] USER: ${t.humanMessage?.slice(0, 200)}`);
      for (const a of t.actions) {
        if (a.type === "tool_use") {
          lines.push(
            `  ${a.tool}: ${(a.command ?? a.filePath ?? a.description ?? "").slice(0, 150)}`,
          );
        }
      }
    }
    if (lines.length) activityLog = lines.join("\n");
  }

  // Load plan for context drift
  let plan = "";
  if (session.slug) {
    try {
      plan = await readFile(
        join(CLAUDE_DIR, "plans", `${session.slug}.md`),
        "utf-8",
      );
      plan = plan.trim().slice(0, 2000);
    } catch {
      // no plan file
    }
  }

  // Get prior results per category
  const prior: Record<string, ReviewCategoryResult> =
    (sup.results?.review as Record<string, ReviewCategoryResult> | undefined) ?? {};

  // Build pre-packaged briefs for each agent
  function agentInstructions(category: string): string {
    return `You are reviewing code. Use Read/Grep/Glob to investigate actual files \u2014 don't just read the diff.
After your analysis, you MUST write your result to .ccboard/${category}.json using the Write tool.
The JSON format:
{
  "category": "${category}",
  "status": "ok|warning|issue",
  "summary": "1-2 sentence overview",
  "methodology": {
    "filesChecked": ["list of files you actually read or grepped"],
    "criteria": "what rules/standards you checked against",
    "baseline": "what you compared to (prior report, best practices, project conventions, etc)"
  },
  "findings": [
    {
      "severity": "high|medium|low",
      "location": "file:line",
      "description": "what the issue is",
      "suggestion": "how to fix it",
      "evidence": "the actual code snippet or pattern you found"
    }
  ]
}
IMPORTANT: "category" MUST be "${category}". Write the file to .ccboard/${category}.json.
If no issues, return status "ok" with empty findings but still fill in methodology.`;
  }

  parts.push(`RECENT ACTIVITY:\n${activityLog}`);

  parts.push(`=== AGENT_BRIEF_START: CODE_QUALITY ===
${agentInstructions("codeQuality")}
Focus: code smells, anti-patterns, missing error handling at system boundaries, poor naming, dead code, unnecessary complexity.
PRIOR FINDINGS: ${JSON.stringify(prior.codeQuality ?? { status: "ok", findings: [] })}
CODE CHANGES:\n${allDiffs}
Start from prior findings. Check if they still apply. Then review new changes. Skip unchanged files.
=== AGENT_BRIEF_END ===`);

  parts.push(`=== AGENT_BRIEF_START: SECURITY ===
${agentInstructions("security")}
Focus: secrets/API keys in code or git, injection vulnerabilities (SQL/XSS/command), insecure auth patterns, sensitive data in logs, .env files in version control.
PRIOR FINDINGS: ${JSON.stringify(prior.security ?? { status: "ok", findings: [] })}
CODE CHANGES:\n${allDiffs}
Start from prior findings. Check if they still apply. Grep for patterns like passwords, tokens, API keys in changed files.
=== AGENT_BRIEF_END ===`);

  parts.push(`=== AGENT_BRIEF_START: SCALABILITY ===
${agentInstructions("scalability")}
Focus: O(n\u00B2)+ algorithms, N+1 queries, unbounded queries/loops, missing pagination, synchronous blocking in async, memory leaks.
PRIOR FINDINGS: ${JSON.stringify(prior.scalability ?? { status: "ok", findings: [] })}
CODE CHANGES:\n${allDiffs}
Start from prior findings. Check if they still apply. Only deep-dive into changed files.
=== AGENT_BRIEF_END ===`);

  parts.push(`=== AGENT_BRIEF_START: CONTEXT_DRIFT ===
${agentInstructions("contextDrift")}
Focus: is work aligned with the plan? Has the session wandered into unrelated files? Going in circles? Signs of confusion?
PRIOR FINDINGS: ${JSON.stringify(prior.contextDrift ?? { status: "ok", findings: [] })}
${plan ? `EXECUTION PLAN:\n${plan}` : "No execution plan found."}
RECENT ACTIVITY:\n${activityLog}
Start from prior findings. Check if drift has gotten worse, resolved, or if new drift appeared.
=== AGENT_BRIEF_END ===`);

  parts.push(
    "Now spawn 4 Agents in parallel \u2014 one per AGENT_BRIEF section above. Pass each its exact brief. Collect results and output the final JSON.",
  );

  // Update hash for next cycle
  sup.lastCommitHash = currentHash;

  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Read supervisor results from .ccboard/review.json
// ---------------------------------------------------------------------------

/** Read the supervisor's review output from .ccboard/review.json in the project */
export async function readSupervisorResults(
  primaryCwd: string,
): Promise<SupervisorResults | null> {
  try {
    const raw = await readFile(
      join(primaryCwd, ".ccboard", "review.json"),
      "utf-8",
    );
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.summary && parsed.review) {
      // Convert reviewedAt to ms if it's an ISO string
      if (parsed.reviewedAt && typeof parsed.reviewedAt === "string") {
        parsed.reviewedAt = new Date(parsed.reviewedAt).getTime();
      }
      return parsed as unknown as SupervisorResults;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Supervisor monitoring loop
// ---------------------------------------------------------------------------

/** Supervisor loop -- sequential, never overlapping */
export async function supervisorLoop(primaryPid: number): Promise<void> {
  const sup = supervisors.get(primaryPid);
  if (!sup || sup.stopped) return;

  try {
    // Wait for supervisor to be ready
    if (!isTmuxPaneWaiting(sup.tmuxSession)) {
      // Still working -- check again later
      sup.timeout = setTimeout(() => { void supervisorLoop(primaryPid); }, 10000);
      return;
    }

    // If we sent a message last cycle, read results now
    if (sup.reviewing) {
      const sessions = await getSessions();
      const primary = sessions.find((s) => s.pid === primaryPid);
      if (primary) {
        const latestResults = await readSupervisorResults(primary.cwd);
        if (latestResults) sup.results = latestResults;
      }
      sup.reviewing = false;
      // Snapshot mtime so we don't re-trigger until real activity
      if (sup.jsonlPath) {
        try {
          const info = await stat(sup.jsonlPath);
          sup.lastJsonlMtime = info.mtimeMs;
        } catch {
          // ignore
        }
      }
    }

    // Get primary session
    const sessions = await getSessions();
    const primary = sessions.find((s) => s.pid === primaryPid);
    if (!primary) {
      // Primary gone -- stop
      try {
        execSync(`tmux kill-session -t ${sup.tmuxSession} 2>/dev/null`);
      } catch {
        // ignore
      }
      supervisors.delete(primaryPid);
      return;
    }

    // Check if JSONL changed since last review -- pause if idle
    let shouldReview = false;
    if (sup.jsonlPath) {
      try {
        const info = await stat(sup.jsonlPath);
        if (!sup.lastJsonlMtime || info.mtimeMs > sup.lastJsonlMtime) {
          sup.lastJsonlMtime = info.mtimeMs;
          shouldReview = true;
        }
      } catch {
        // ignore
      }
    }

    if (shouldReview) {
      // Build and send review message
      const msg = await buildReviewMessage(primary, sup);
      sendToTmuxSession(sup.tmuxSession, msg);
      sup.reviewing = true;
    }
  } catch {
    // swallow errors to keep the loop alive
  }

  // Schedule next check -- only ONE at a time, no overlap possible
  sup.timeout = setTimeout(() => { void supervisorLoop(primaryPid); }, 30000);
}

// ---------------------------------------------------------------------------
// Reconnection
// ---------------------------------------------------------------------------

/** Try to reconnect to an existing supervisor tmux session */
export async function reconnectSupervisor(
  pid: number,
  session: Session,
): Promise<SupervisorState | null> {
  // Check pairing file
  const pairing = await readSessionPairing(session.cwd);
  const pairingRec = pairing as unknown as Record<string, unknown> | null;
  const supTmux =
    (typeof pairingRec?.supTmux === "string" ? pairingRec.supTmux : null) ??
    `${TMUX_PREFIX}-sup-${session.shortName}`
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .slice(0, 40);

  // Check if the tmux session actually exists
  try {
    execSync(`tmux has-session -t ${supTmux} 2>/dev/null`);
  } catch {
    return null; // No tmux session -- supervisor isn't running
  }

  // Reconnect: register in the map
  const primaryJsonlPath = await resolveJsonlForPid(
    session.pid,
    session.cwd,
    session.sessionId,
  );
  const sup: SupervisorState = {
    tmuxSession: supTmux,
    stopped: false,
    jsonlPath: primaryJsonlPath,
    results: null,
  };
  supervisors.set(pid, sup);
  return sup;
}

// ---------------------------------------------------------------------------
// Supervisor JSONL resolution
// ---------------------------------------------------------------------------

/** Resolve the supervisor's JSONL path -- handles resumed sessions via pairing file */
export async function resolveSupervisorJsonlPath(
  cwd: string,
  tmuxSession: string,
): Promise<string | null> {
  const projectDir = cwdToProjectDir(cwd);

  // 1. Check pairing for explicit supervisorJsonl path
  try {
    const pairing = await readSessionPairing(cwd);
    if (pairing?.supervisorJsonl) {
      try {
        await stat(pairing.supervisorJsonl);
        log.debug({ method: "pairing-supervisorJsonl", file: pairing.supervisorJsonl.split("/").pop() }, "resolveSupervisorJsonlPath");
        return pairing.supervisorJsonl;
      } catch {
        log.debug("pairing supervisorJsonl file missing, falling through");
      }
    }

    // 1b. Try supervisorSessionId from pairing
    if (pairing?.supervisorSessionId) {
      const pairingPath = join(
        PROJECTS_DIR,
        projectDir,
        `${pairing.supervisorSessionId}.jsonl`,
      );
      try {
        await stat(pairingPath);
        log.debug({ method: "pairing-supervisorSessionId", file: pairingPath.split("/").pop() }, "resolveSupervisorJsonlPath");
        // Update pairing with the discovered path
        void updateSessionPairing(cwd, { supervisorJsonl: pairingPath });
        return pairingPath;
      } catch {
        // fall through
      }
    }
  } catch {
    // fall through
  }

  // 2. Try tmux pane PID -> session file -> JSONL
  try {
    const panePid = execSync(
      `tmux list-panes -t ${tmuxSession} -F "#{pane_pid}" 2>/dev/null`,
      { encoding: "utf-8" },
    ).trim();
    const raw = await readFile(
      join(SESSIONS_DIR, `${panePid}.json`),
      "utf-8",
    );
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const supSessionId = parsed.sessionId;
    if (typeof supSessionId !== "string") return null;
    const exactPath = join(PROJECTS_DIR, projectDir, `${supSessionId}.jsonl`);
    await stat(exactPath);
    log.debug({ method: "tmux-pid", file: exactPath.split("/").pop() }, "resolveSupervisorJsonlPath");
    // Update pairing with the discovered path and sessionId
    void updateSessionPairing(cwd, { supervisorJsonl: exactPath, supervisorSessionId: supSessionId });
    return exactPath;
  } catch {
    // fall through
  }

  log.debug({ tmuxSession }, "resolveSupervisorJsonlPath: no JSONL found");
  return null;
}

// ---------------------------------------------------------------------------
// Supervisor message extraction (for the messages endpoint)
// ---------------------------------------------------------------------------

/** Extract human + assistant chat messages from the supervisor's JSONL */
export function extractSupervisorMessages(
  raw: string,
  limit: number,
): ChatMessage[] {
  const messages: ChatMessage[] = [];

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;

      if (
        entry.type === "user" &&
        entry.promptId &&
        !entry.sourceToolAssistantUUID
      ) {
        const text = extractHumanText(entry as JsonlUserEntry);
        if (text.trim()) {
          messages.push({
            role: "human",
            text,
            timestamp: entry.timestamp as string | undefined,
          });
        }
      }

      if (entry.type === "assistant") {
        const message = entry.message as Record<string, unknown> | undefined;
        const content = message?.content;
        if (!Array.isArray(content)) continue;
        const textParts = (content as Record<string, unknown>[])
          .filter(
            (c) =>
              c.type === "text" &&
              typeof c.text === "string" &&
              (c.text as string).trim(),
          )
          .map((c) => c.text as string);
        if (textParts.length > 0) {
          messages.push({
            role: "assistant",
            text: textParts.join("\n"),
            timestamp: entry.timestamp as string | undefined,
          });
        }
      }
    } catch {
      // skip malformed lines
    }
  }

  return limit > 0 ? messages.slice(-limit) : messages;
}
