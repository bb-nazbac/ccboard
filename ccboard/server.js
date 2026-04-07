import express from "express";
import { readdir, readFile, open } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { stat } from "fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3200;
const CLAUDE_DIR = join(homedir(), ".claude");
const SESSIONS_DIR = join(CLAUDE_DIR, "sessions");
const PROJECTS_DIR = join(CLAUDE_DIR, "projects");

// No JSONL path cache — always resolve fresh to handle session changes

// Encode a cwd path to the project directory name Claude uses
// /Users/bahaa/Documents/foo_bar baz → -Users-bahaa-Documents-foo-bar-baz
function cwdToProjectDir(cwd) {
  return cwd.replace(/[\/ _]/g, "-");
}

// Read the last N bytes of a file and return complete lines
async function tailFile(filePath, bytes = 16384) {
  let fh;
  try {
    const info = await stat(filePath);
    fh = await open(filePath, "r");
    const start = Math.max(0, info.size - bytes);
    const buf = Buffer.alloc(Math.min(bytes, info.size));
    await fh.read(buf, 0, buf.length, start);
    const text = buf.toString("utf-8");
    // Drop first potentially partial line if we didn't read from start
    const lines = text.split("\n");
    if (start > 0) lines.shift();
    return lines.filter((l) => l.trim());
  } catch {
    return [];
  } finally {
    await fh?.close();
  }
}

// Get session IDs belonging to supervisor tmux sessions
async function getSupervisorSessionIds() {
  const ids = new Set();
  const managed = getManagedTmuxSessions();
  for (const name of managed) {
    if (!name.includes("-sup-")) continue;
    try {
      const panePid = execSync(
        `tmux list-panes -t ${name} -F "#{pane_pid}" 2>/dev/null`,
        { encoding: "utf-8" }
      ).trim();
      const raw = await readFile(join(SESSIONS_DIR, `${panePid}.json`), "utf-8");
      ids.add(JSON.parse(raw).sessionId);
    } catch {}
  }
  return ids;
}

// Find the most recently modified JSONL in a project directory
// Excludes JONLs belonging to supervisor sessions
async function findLatestJsonl(projectDir, cwd) {
  const dirPath = join(PROJECTS_DIR, projectDir);
  let files;
  try {
    files = await readdir(dirPath);
  } catch {
    return null;
  }
  const jsonls = files.filter((f) => f.endsWith(".jsonl"));
  if (jsonls.length === 0) return null;

  // Collect ALL supervisor session IDs to exclude:
  // 1. From running tmux sessions
  const supIds = await getSupervisorSessionIds();
  // 2. From the pairing file (catches old/stopped supervisors)
  if (cwd) {
    try {
      const pairing = await readSessionPairing(cwd);
      if (pairing?.supervisorSessionId) supIds.add(pairing.supervisorSessionId);
      // Also exclude any previously known supervisor IDs
      if (pairing?.previousSupervisorIds) {
        for (const id of pairing.previousSupervisorIds) supIds.add(id);
      }
    } catch {}
  }
  // 3. Heuristic: check first few lines of each JSONL for supervisor markers
  for (const f of jsonls) {
    const sid = f.replace(".jsonl", "");
    if (supIds.has(sid)) continue;
    try {
      const fh = await open(join(dirPath, f), "r");
      const buf = Buffer.alloc(2000);
      await fh.read(buf, 0, 2000, 0);
      await fh.close();
      const head = buf.toString("utf-8");
      if (head.includes("supervising") || head.includes("SUPERVISOR") || head.includes("council") || head.includes("pair-programming supervisor")) {
        supIds.add(sid);
      }
    } catch {}
  }

  let latest = null;
  let latestMtime = 0;
  for (const f of jsonls) {
    const sessionId = f.replace(".jsonl", "");
    if (supIds.has(sessionId)) continue;

    try {
      const info = await stat(join(dirPath, f));
      if (info.mtimeMs > latestMtime) {
        latestMtime = info.mtimeMs;
        latest = f;
      }
    } catch {}
  }
  return latest ? join(dirPath, latest) : null;
}

// Extract context from the last few JSONL entries for a session
async function getSessionContext(cwd, sessionId) {
  const projectDir = cwdToProjectDir(cwd);

  // Try exact session ID match first, then fall back to most recent JSONL
  let jsonlPath = join(PROJECTS_DIR, projectDir, `${sessionId}.jsonl`);
  try {
    await stat(jsonlPath);
  } catch {
    jsonlPath = await findLatestJsonl(projectDir, cwd);
    if (!jsonlPath) return null;
  }

  const lines = await tailFile(jsonlPath, 65536);
  if (lines.length === 0) return null;

  let lastActivity = null;
  let lastUserMessage = null;
  let lastAssistantText = null;
  let lastToolName = null;
  let slug = null;
  let isWaitingForUser = false;

  // Parse lines from end to get the most recent context
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const entry = JSON.parse(lines[i]);

      // Track the most recent timestamp
      if (entry.timestamp && !lastActivity) {
        lastActivity = entry.timestamp;
      }

      // Grab slug from any entry
      if (entry.slug && !slug) {
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
        const content = entry.message?.content;
        if (Array.isArray(content)) {
          // Get text blocks
          const textBlock = content.find((c) => c.type === "text");
          if (textBlock?.text) {
            lastAssistantText = textBlock.text.slice(0, 200);
          }
          // Get tool use
          const toolBlock = content.find((c) => c.type === "tool_use");
          if (toolBlock?.name && !lastToolName) {
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
        const content = entry.message?.content;
        if (typeof content === "string" && content.trim()) {
          lastUserMessage = content.slice(0, 200);
        } else if (Array.isArray(content)) {
          const textPart = content.find((c) => c.type === "text");
          if (textPart?.text) {
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
  let snippet = null;
  if (lastAssistantText) {
    // Truncate to first sentence or 120 chars
    const firstLine = lastAssistantText.split("\n")[0];
    snippet = firstLine.length > 120
      ? firstLine.slice(0, 117) + "..."
      : firstLine;
  } else if (lastToolName) {
    snippet = `Using ${lastToolName}...`;
  }

  return {
    lastActivity: lastActivity ? new Date(lastActivity).getTime() : null,
    snippet,
    lastUserMessage: lastUserMessage
      ? lastUserMessage.split("\n")[0].slice(0, 120)
      : null,
    slug,
    isWaitingForUser,
  };
}

// Get running claude processes with their CPU/state info
function getClaudeProcesses() {
  try {
    const output = execSync(
      `ps -eo pid,stat,%cpu,tty,command | grep -E '\\bclaude\\b' | grep -v grep`,
      { encoding: "utf-8" }
    );
    const processes = new Map();
    for (const line of output.trim().split("\n")) {
      if (!line.trim()) continue;
      const match = line
        .trim()
        .match(/^(\d+)\s+(\S+)\s+([\d.]+)\s+(\S+)\s+(.+)$/);
      if (!match) continue;
      const [, pid, stat, cpu, tty, command] = match;
      if (
        command.includes("Claude Helper") ||
        command.includes("Claude.app") ||
        command.includes("crashpad") ||
        command.includes("ShipIt")
      )
        continue;
      processes.set(Number(pid), {
        pid: Number(pid),
        stat,
        cpu: parseFloat(cpu),
        tty,
      });
    }
    return processes;
  } catch {
    return new Map();
  }
}

// Check if a tmux pane is showing Claude Code's input prompt
function isTmuxPaneWaiting(tmuxSession) {
  if (!tmuxSession) return false;
  try {
    const pane = execSync(
      `tmux capture-pane -t ${tmuxSession} -p 2>/dev/null`,
      { encoding: "utf-8" }
    );
    // Claude Code shows "❯" prompt when waiting for input
    const lines = pane.split("\n").filter((l) => l.trim());
    const lastFew = lines.slice(-5).join("\n");
    return lastFew.includes("❯");
  } catch {
    return false;
  }
}

// Determine session status combining process state + JSONL context + tmux pane
function inferStatus(proc, context, tmuxSession) {
  if (!proc) return "dead";

  // High CPU = actively working right now
  if (proc.cpu > 5) return "working";

  // JSONL says Claude finished its turn → waiting for user input
  if (context?.isWaitingForUser) return "waiting";

  // For tmux-managed sessions, check the pane content for the prompt
  if (tmuxSession && isTmuxPaneWaiting(tmuxSession)) return "waiting";

  // Check how stale the last activity is
  if (context?.lastActivity) {
    const idleMs = Date.now() - context.lastActivity;
    // If last activity was >10 min ago, it's idle
    if (idleMs > 10 * 60 * 1000) return "idle";
  }

  // Default: if foreground process is sleeping, likely waiting
  if (proc.stat.includes("S+")) return "waiting";
  if (proc.stat.includes("R")) return "working";
  return "idle";
}

// Read all session files and correlate with processes + JSONL context
async function getSessions() {
  const processes = getClaudeProcesses();
  let files;
  try {
    files = await readdir(SESSIONS_DIR);
  } catch {
    return [];
  }

  const sessions = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(SESSIONS_DIR, file), "utf-8");
      const data = JSON.parse(raw);
      const proc = processes.get(data.pid);

      // Skip processes that aren't running
      if (!proc) continue;

      const cwd = data.cwd || "unknown";
      const parts = cwd.split("/");
      const shortName = parts[parts.length - 1] || parts[parts.length - 2];

      // Get rich context from JSONL — resolve and cache path before any supervisor exists
      await resolveJsonlForPid(data.pid, cwd, data.sessionId);
      const context = await getSessionContext(cwd, data.sessionId);

      // Check if this session is in a ccboard-managed tmux session
      const tmuxSession = findTmuxSessionForPid(data.pid);

      // Skip supervisor sessions — they shouldn't appear in the sessions list
      if (tmuxSession && tmuxSession.includes("-sup-")) continue;

      const status = inferStatus(proc, context, tmuxSession);

      sessions.push({
        pid: data.pid,
        sessionId: data.sessionId,
        cwd,
        shortName,
        startedAt: data.startedAt,
        lastActivity: context?.lastActivity || data.startedAt,
        status,
        cpu: proc.cpu,
        tty: proc.tty,
        snippet: context?.snippet || null,
        lastUserMessage: context?.lastUserMessage || null,
        slug: context?.slug || null,
        managed: !!tmuxSession,
        tmuxSession: tmuxSession || null,
      });
    } catch {
      // skip corrupted files
    }
  }

  // Sort: waiting first, then working, then idle. Within same status, most recent first.
  const order = { waiting: 0, working: 1, idle: 2 };
  sessions.sort((a, b) => {
    const statusDiff = (order[a.status] ?? 3) - (order[b.status] ?? 3);
    if (statusDiff !== 0) return statusDiff;
    return b.lastActivity - a.lastActivity;
  });

  return sessions;
}

// Resolve the JSONL path for a given cwd + sessionId
async function resolveJsonlPath(cwd, sessionId) {
  const projectDir = cwdToProjectDir(cwd);
  let jsonlPath = join(PROJECTS_DIR, projectDir, `${sessionId}.jsonl`);
  try {
    await stat(jsonlPath);
    return jsonlPath;
  } catch {
    return await findLatestJsonl(projectDir);
  }
}

// Find the largest JSONL in a project directory (most likely the main agent conversation)
async function findLargestJsonl(projectDir) {
  const dirPath = join(PROJECTS_DIR, projectDir);
  let files;
  try {
    files = await readdir(dirPath);
  } catch {
    return null;
  }
  const jsonls = files.filter((f) => f.endsWith(".jsonl"));
  if (jsonls.length === 0) return null;

  const supIds = await getSupervisorSessionIds();

  let largest = null;
  let largestSize = 0;
  for (const f of jsonls) {
    const sessionId = f.replace(".jsonl", "");
    if (supIds.has(sessionId)) continue;
    try {
      const info = await stat(join(dirPath, f));
      if (info.size > largestSize) {
        largestSize = info.size;
        largest = f;
      }
    } catch {}
  }
  return largest ? join(dirPath, largest) : null;
}

// Resolve the ACTIVE JSONL (what the agent is writing to right now)
async function resolveActiveJsonl(pid, cwd, sessionId) {
  const projectDir = cwdToProjectDir(cwd);

  // 1. Try exact sessionId match
  const exactPath = join(PROJECTS_DIR, projectDir, `${sessionId}.jsonl`);
  try {
    await stat(exactPath);
    return exactPath;
  } catch {}

  // 2. Find the JSONL that was modified most recently AND contains entries
  //    with this session's PID or sessionId. If we can't match, just pick
  //    the most recently modified non-supervisor file.
  const dirPath = join(PROJECTS_DIR, projectDir);
  let files;
  try { files = await readdir(dirPath); } catch { return null; }
  const jsonls = files.filter(f => f.endsWith(".jsonl"));

  // Get the current supervisor's session ID to exclude
  const currentSupId = new Set();
  try {
    const pairing = await readSessionPairing(cwd);
    if (pairing?.supervisorSessionId) currentSupId.add(pairing.supervisorSessionId);
  } catch {}

  // Pick the most recently modified JSONL, excluding ONLY the current supervisor
  let latest = null;
  let latestMtime = 0;
  for (const f of jsonls) {
    const sid = f.replace(".jsonl", "");
    if (currentSupId.has(sid)) continue;

    try {
      const info = await stat(join(dirPath, f));
      if (info.mtimeMs > latestMtime) {
        latestMtime = info.mtimeMs;
        latest = f;
      }
    } catch {}
  }
  return latest ? join(dirPath, latest) : null;
}

// Resolve ALL relevant JONLs for full history (active + pairing + largest)
async function resolveHistoryJsonls(pid, cwd, sessionId) {
  const projectDir = cwdToProjectDir(cwd);
  const supIds = await getSupervisorSessionIds();
  const paths = new Set();

  // Active JSONL
  const active = await resolveActiveJsonl(pid, cwd, sessionId);
  if (active) paths.add(active);

  // Pairing file JSONL (may be a different, older session)
  try {
    const pairing = await readSessionPairing(cwd);
    if (pairing?.agentSessionId) {
      const pairingPath = join(PROJECTS_DIR, projectDir, `${pairing.agentSessionId}.jsonl`);
      await stat(pairingPath);
      if (!supIds.has(pairing.agentSessionId)) paths.add(pairingPath);
    }
  } catch {}

  // Also include the largest non-supervisor JSONL (the main conversation)
  const largest = await findLargestJsonl(projectDir);
  if (largest) paths.add(largest);

  return [...paths];
}

// Read full conversation from multiple JONLs (deduplicates by uuid)
async function readFullConversationMulti(jsonlPaths) {
  const seen = new Set();
  const entries = [];
  for (const p of jsonlPaths) {
    try {
      const raw = await readFile(p, "utf-8");
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          const uuid = entry.uuid || entry.requestId || line.slice(0, 50);
          if (!seen.has(uuid)) {
            seen.add(uuid);
            entries.push(entry);
          }
        } catch {}
      }
    } catch {}
  }
  // Sort by timestamp
  entries.sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return ta - tb;
  });
  return entries;
}

// Backwards compat alias
async function resolveJsonlForPid(pid, cwd, sessionId) {
  return resolveActiveJsonl(pid, cwd, sessionId);
}

// Read full JSONL and parse into structured conversation data
async function readFullConversation(jsonlPath) {
  const raw = await readFile(jsonlPath, "utf-8");
  const entries = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // skip
    }
  }
  return entries;
}

// Parse a single action from an assistant entry's content block
function parseToolAction(block, timestamp) {
  if (block.type === "text" && block.text?.trim()) {
    return { type: "assistant_text", text: block.text.slice(0, 2000), timestamp };
  }
  if (block.type !== "tool_use") return null;
  const action = { type: "tool_use", tool: block.name, timestamp };
  const inp = block.input || {};
  switch (block.name) {
    case "Bash":
      action.command = inp.command?.slice(0, 500);
      action.description = inp.description;
      break;
    case "Read":
      action.filePath = inp.file_path;
      break;
    case "Write":
      action.filePath = inp.file_path;
      action.newString = inp.content?.slice(0, 1000);
      break;
    case "Edit":
      action.filePath = inp.file_path;
      action.oldString = inp.old_string?.slice(0, 1000);
      action.newString = inp.new_string?.slice(0, 1000);
      break;
    case "Glob":
      action.pattern = inp.pattern;
      break;
    case "Grep":
      action.pattern = inp.pattern;
      action.path = inp.path;
      break;
    case "Agent":
      action.description = inp.description;
      action.agentType = inp.subagent_type;
      break;
    default:
      action.input = JSON.stringify(inp).slice(0, 300);
  }
  return action;
}

// Extract human message text from a JSONL entry
function extractHumanText(entry) {
  const content = entry.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
  }
  return "";
}

// Check if a message is supervisor noise
function isSupervisorNoise(text) {
  if (!text) return false;
  return (
    text.includes("pair-programming supervisor") ||
    text.includes("latest activity from the session you are supervising") ||
    text.includes("Provide your initial review as JSON") ||
    text.includes("Provide your updated review as JSON") ||
    /^\s*\{"summary"/.test(text)
  );
}

// Extract ALL actions grouped into turns by human message
function extractActionTurns(entries) {
  const turns = [];
  let currentTurn = null;

  for (const e of entries) {
    // Human message starts a new turn
    if (e.type === "user" && e.promptId && !e.sourceToolAssistantUUID) {
      const text = extractHumanText(e);
      if (!text.trim()) continue;
      // Skip supervisor noise
      if (isSupervisorNoise(text)) continue;
      currentTurn = {
        humanMessage: text.slice(0, 2000),
        timestamp: e.timestamp,
        actions: [],
      };
      turns.push(currentTurn);
    }

    // Assistant actions go into the current turn
    if (e.type === "assistant" && currentTurn) {
      const content = e.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        // Skip supervisor JSON responses
        if (block.type === "text" && isSupervisorNoise(block.text)) continue;
        const action = parseToolAction(block, e.timestamp);
        if (action) currentTurn.actions.push(action);
      }
    }
  }

  return turns;
}

// Build conversation message chain (human + assistant text only, no tool internals)
function extractMessageChain(entries) {
  const messages = [];

  for (const e of entries) {
    // Human messages
    if (e.type === "user" && e.promptId && !e.sourceToolAssistantUUID) {
      const text = extractHumanText(e);
      if (!text.trim() || isSupervisorNoise(text)) continue;
      messages.push({
        role: "human",
        text: text,
        timestamp: e.timestamp,
      });
    }

    // Assistant text responses (not tool calls)
    if (e.type === "assistant") {
      const content = e.message?.content;
      if (!Array.isArray(content)) continue;
      const textParts = content
        .filter((c) => c.type === "text" && c.text?.trim() && !isSupervisorNoise(c.text))
        .map((c) => c.text);
      if (textParts.length > 0) {
        messages.push({
          role: "assistant",
          text: textParts.join("\n"),
          timestamp: e.timestamp,
        });
      }
    }
  }

  return messages;
}

// Extract context window info from entries
function extractContextInfo(entries) {
  // Find the most recent assistant message with usage data
  let lastUsage = null;
  let totalTurns = 0;
  let totalToolCalls = 0;

  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.type === "assistant") {
      const usage = e.message?.usage;
      if (usage && !lastUsage) {
        lastUsage = {
          inputTokens: usage.input_tokens || 0,
          cacheRead: usage.cache_read_input_tokens || 0,
          cacheCreation: usage.cache_creation_input_tokens || 0,
          outputTokens: usage.output_tokens || 0,
        };
      }
    }
  }

  // Count turns and tool calls
  for (const e of entries) {
    if (e.type === "user" && e.promptId && !e.sourceToolAssistantUUID) {
      totalTurns++;
    }
    if (e.type === "assistant") {
      const content = e.message?.content;
      if (Array.isArray(content)) {
        totalToolCalls += content.filter((c) => c.type === "tool_use").length;
      }
    }
  }

  const totalContextTokens = lastUsage
    ? lastUsage.inputTokens + lastUsage.cacheRead + lastUsage.cacheCreation
    : 0;

  return {
    totalContextTokens,
    lastUsage,
    totalTurns,
    totalToolCalls,
    totalMessages: entries.length,
  };
}

// API
app.get("/api/sessions", async (_req, res) => {
  const sessions = await getSessions();
  res.json(sessions);
});

// Session file tree (for graph visualization)
app.get("/api/sessions/:pid/files", async (req, res) => {
  const sessions = await getSessions();
  const session = sessions.find((s) => s.pid === Number(req.params.pid));
  if (!session) return res.status(404).json({ error: "session not found" });

  try {
    const output = execSync(
      "git ls-files 2>/dev/null || find . -type f -not -path '*/node_modules/*' -not -path '*/.git/*' | head -500",
      { cwd: session.cwd, encoding: "utf-8", timeout: 5000 }
    ).trim();
    res.json(output.split("\n").filter((f) => f.trim()));
  } catch {
    res.json([]);
  }
});

// Session git diff (for /diff command)
app.get("/api/sessions/:pid/diff", async (req, res) => {
  const sessions = await getSessions();
  const session = sessions.find((s) => s.pid === Number(req.params.pid));
  if (!session) return res.status(404).json({ error: "session not found" });

  let diff = "";
  let staged = "";
  try {
    diff = execSync("git diff", { cwd: session.cwd, encoding: "utf-8", timeout: 10000 }).trim();
  } catch {}
  try {
    staged = execSync("git diff --staged", { cwd: session.cwd, encoding: "utf-8", timeout: 10000 }).trim();
  } catch {}

  res.json({ diff, staged });
});

// Session detail: all actions grouped by turn (reads full history)
app.get("/api/sessions/:pid/actions", async (req, res) => {
  const sessions = await getSessions();
  const session = sessions.find((s) => s.pid === Number(req.params.pid));
  if (!session) return res.status(404).json({ error: "session not found" });

  const jsonlPaths = await resolveHistoryJsonls(session.pid, session.cwd, session.sessionId);
  if (jsonlPaths.length === 0) return res.json([]);

  const entries = await readFullConversationMulti(jsonlPaths);
  const turns = extractActionTurns(entries);
  res.json(turns);
});

// Session detail: message chain (reads full history)
app.get("/api/sessions/:pid/messages", async (req, res) => {
  const sessions = await getSessions();
  const session = sessions.find((s) => s.pid === Number(req.params.pid));
  if (!session) return res.status(404).json({ error: "session not found" });

  const jsonlPaths = await resolveHistoryJsonls(session.pid, session.cwd, session.sessionId);
  if (jsonlPaths.length === 0) return res.json([]);

  const entries = await readFullConversationMulti(jsonlPaths);
  const messages = extractMessageChain(entries);
  res.json(messages);
});

// Session detail: context window info
app.get("/api/sessions/:pid/context", async (req, res) => {
  const sessions = await getSessions();
  const session = sessions.find((s) => s.pid === Number(req.params.pid));
  if (!session) return res.status(404).json({ error: "session not found" });

  const jsonlPath = await resolveJsonlForPid(session.pid, session.cwd, session.sessionId);
  if (!jsonlPath) return res.json({});

  const entries = await readFullConversation(jsonlPath);
  const context = extractContextInfo(entries);
  res.json(context);
});

// ============================================================
// tmux-based session management
// ============================================================

const TMUX_PREFIX = "ccb"; // ccboard tmux session prefix

// List ccboard-managed tmux sessions
function getManagedTmuxSessions() {
  try {
    const output = execSync(
      `tmux list-sessions -F "#{session_name}:#{session_created}" 2>/dev/null`,
      { encoding: "utf-8" }
    );
    const sessions = [];
    for (const line of output.trim().split("\n")) {
      if (!line.startsWith(TMUX_PREFIX + "-")) continue;
      const [name] = line.split(":");
      sessions.push(name);
    }
    return sessions;
  } catch {
    return [];
  }
}

// Find the tmux session name for a given PID (if it's in a ccboard tmux session)
function findTmuxSessionForPid(pid) {
  try {
    const output = execSync(
      `tmux list-panes -a -F "#{session_name}:#{pane_pid}" 2>/dev/null`,
      { encoding: "utf-8" }
    );
    for (const line of output.trim().split("\n")) {
      const [sessionName, panePid] = line.split(":");
      if (!sessionName.startsWith(TMUX_PREFIX + "-")) continue;
      // pane_pid could BE the claude process (no shell wrapper), or claude could be a child
      if (Number(panePid) === pid) return sessionName;
      try {
        const children = execSync(
          `pgrep -P ${panePid} 2>/dev/null || echo ""`,
          { encoding: "utf-8" }
        ).trim();
        if (
          children
            .split("\n")
            .map((p) => Number(p.trim()))
            .includes(pid)
        )
          return sessionName;
      } catch {
        // skip
      }
    }
    return null;
  } catch {
    return null;
  }
}

app.use(express.json());

// Read the .ccboard/session.json pairing file for a project
async function readSessionPairing(cwd) {
  try {
    const raw = await readFile(join(cwd, ".ccboard", "session.json"), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Write the .ccboard/session.json pairing file
async function writeSessionPairing(cwd, pairing) {
  const { writeFileSync, mkdirSync } = await import("fs");
  const dir = join(cwd, ".ccboard");
  try { mkdirSync(dir, { recursive: true }); } catch {}
  writeFileSync(join(dir, "session.json"), JSON.stringify(pairing, null, 2));
}

// Launch a new Claude Code session + supervisor in tmux
app.post("/api/launch", async (req, res) => {
  const { cwd, resume, sessionId, name } = req.body;
  if (!cwd) return res.status(400).json({ error: "cwd required" });

  const dirName = cwd.split("/").pop() || "session";
  const agentTmux = `${TMUX_PREFIX}-${dirName}`
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 40);
  const supTmux = `${TMUX_PREFIX}-sup-${dirName}`
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 40);

  try {
    // Kill existing if names collide
    try { execSync(`tmux kill-session -t ${agentTmux} 2>/dev/null`); } catch {}
    try { execSync(`tmux kill-session -t ${supTmux} 2>/dev/null`); } catch {}

    // Check for existing pairing (for resume)
    const pairing = await readSessionPairing(cwd);

    // Build agent command
    let agentCmd = "claude --dangerously-skip-permissions --model sonnet";
    if (resume && sessionId) {
      agentCmd += ` --resume ${sessionId}`;
    } else if (resume && pairing?.agentSessionId) {
      agentCmd += ` --resume ${pairing.agentSessionId}`;
    } else if (resume) {
      agentCmd += " --continue";
    }
    if (name) {
      agentCmd += ` --name ${JSON.stringify(name)}`;
    }

    // Launch agent
    execSync(
      `tmux new-session -d -s ${agentTmux} -c ${JSON.stringify(cwd)} ${JSON.stringify(agentCmd)}`,
      { timeout: 5000 }
    );

    // Build supervisor command
    const systemPrompt = buildSupervisorSystemPrompt(agentTmux).replace(/"/g, '\\"');
    let supCmd = `claude --dangerously-skip-permissions --model sonnet --system-prompt "${systemPrompt}"`;
    if (resume && pairing?.supervisorSessionId) {
      supCmd += ` --resume ${pairing.supervisorSessionId}`;
    }

    // Launch supervisor
    execSync(
      `tmux new-session -d -s ${supTmux} -c ${JSON.stringify(cwd)} ${JSON.stringify(supCmd)}`,
      { timeout: 5000 }
    );

    // Wait for both to register, then save pairing
    setTimeout(async () => {
      try {
        // Read agent's sessionId from its session file
        const agentPanePid = execSync(
          `tmux list-panes -t ${agentTmux} -F "#{pane_pid}" 2>/dev/null`,
          { encoding: "utf-8" }
        ).trim();
        const supPanePid = execSync(
          `tmux list-panes -t ${supTmux} -F "#{pane_pid}" 2>/dev/null`,
          { encoding: "utf-8" }
        ).trim();

        let agentSid = sessionId; // If resuming, we already know it
        try {
          const raw = await readFile(join(SESSIONS_DIR, `${agentPanePid}.json`), "utf-8");
          const data = JSON.parse(raw);
          // For new sessions, use the new sessionId. For resumed, keep the original.
          if (!resume) agentSid = data.sessionId;
        } catch {}

        let supSid = null;
        try {
          const raw = await readFile(join(SESSIONS_DIR, `${supPanePid}.json`), "utf-8");
          supSid = JSON.parse(raw).sessionId;
        } catch {}

        // Use the original IDs if resuming (the JSONL filenames don't change)
        const finalAgentSid = resume && pairing?.agentSessionId ? pairing.agentSessionId : agentSid;
        const finalSupSid = resume && pairing?.supervisorSessionId ? pairing.supervisorSessionId : supSid;

        if (finalAgentSid || finalSupSid) {
          await writeSessionPairing(cwd, {
            agentSessionId: finalAgentSid || null,
            supervisorSessionId: finalSupSid || null,
            agentTmux,
            supTmux,
            cwd,
            updatedAt: new Date().toISOString(),
          });
        }
      } catch {}
    }, 8000);

    // Send initial context to supervisor once ready
    const contextMsg = `You are now supervising the "${dirName}" session (${cwd}).
The agent is running in tmux session: ${agentTmux}
Run: mkdir -p .ccboard && (grep -q '.ccboard/' .gitignore 2>/dev/null || echo '.ccboard/' >> .gitignore)
Then introduce yourself and tell me what you see in this project. Read the recent git log and any CLAUDE.md or README.`;

    let attempts = 0;
    const sendInitial = async () => {
      attempts++;
      if (attempts > 20) return;
      if (!isTmuxPaneWaiting(supTmux)) {
        setTimeout(sendInitial, 2000);
        return;
      }
      try {
        const tmpFile = `/tmp/ccboard-sup-init-${Date.now()}.txt`;
        const { writeFileSync: ws, unlinkSync: ul } = await import("fs");
        ws(tmpFile, contextMsg);
        execSync(`tmux load-buffer ${tmpFile}`);
        execSync(`tmux paste-buffer -t ${supTmux}`);
        await new Promise((r) => setTimeout(r, 500));
        execSync(`tmux send-keys -t ${supTmux} Enter`);
        ul(tmpFile);
      } catch {
        setTimeout(sendInitial, 2000);
      }
    };
    setTimeout(sendInitial, 3000);

    // Register supervisor in the supervisors map (keyed by agent PID once known)
    setTimeout(async () => {
      try {
        const agentPanePid = Number(execSync(
          `tmux list-panes -t ${agentTmux} -F "#{pane_pid}" 2>/dev/null`,
          { encoding: "utf-8" }
        ).trim());

        const pairing = await readSessionPairing(cwd);
        const agentJsonlId = pairing?.agentSessionId;
        const projectDir = cwdToProjectDir(cwd);
        const agentJsonlPath = agentJsonlId
          ? join(PROJECTS_DIR, projectDir, `${agentJsonlId}.jsonl`)
          : await findLargestJsonl(projectDir);

        supervisors.set(agentPanePid, {
          tmuxSession: supTmux,
          stopped: false,
          jsonlPath: agentJsonlPath,
          results: null,
        });

        // JSONL path resolved dynamically — no caching needed
      } catch {}
    }, 10000);

    res.json({ ok: true, agentTmux, supTmux });
  } catch (err) {
    res
      .status(500)
      .json({ error: `failed to launch: ${err.message.slice(0, 200)}` });
  }
});

// Send a message to a ccboard-managed session via tmux send-keys
app.post("/api/sessions/:pid/send", async (req, res) => {
  const sessions = await getSessions();
  const session = sessions.find((s) => s.pid === Number(req.params.pid));
  if (!session) return res.status(404).json({ error: "session not found" });
  if (session.status !== "waiting")
    return res.status(400).json({ error: "session is not waiting for input" });

  const { message } = req.body;
  if (!message || typeof message !== "string")
    return res.status(400).json({ error: "message required" });

  // Find the tmux session this PID belongs to
  const tmuxSession = findTmuxSessionForPid(session.pid);
  if (!tmuxSession) {
    return res.status(400).json({
      error:
        "this session was not launched through ccboard — only ccboard-launched sessions support sending messages",
    });
  }

  try {
    // Use tmux send-keys — universal, works with any terminal app
    // Write message to a temp file and use load-buffer to avoid escaping issues
    const tmpFile = `/tmp/ccboard-msg-${Date.now()}.txt`;
    const { writeFileSync, unlinkSync } = await import("fs");
    writeFileSync(tmpFile, message);
    execSync(`tmux load-buffer ${tmpFile}`);
    execSync(`tmux paste-buffer -t ${tmuxSession}`);
    execSync(`tmux send-keys -t ${tmuxSession} Enter`);
    unlinkSync(tmpFile);
    res.json({ ok: true });
  } catch (err) {
    res
      .status(500)
      .json({ error: `failed to send: ${err.message.slice(0, 200)}` });
  }
});

// List recent sessions that can be resumed (from ~/.claude/projects)
// Excludes any session that is currently active (running in terminal or tmux)
app.get("/api/resumable", async (_req, res) => {
  try {
    // Get all currently active sessions to exclude them
    // Compare using encoded project dir names since decoding is lossy
    const activeSessions = await getSessions();
    const activeProjectDirs = new Set(
      activeSessions.map((s) => cwdToProjectDir(s.cwd))
    );

    const projects = await readdir(PROJECTS_DIR);
    const resumable = [];

    for (const proj of projects) {
      const projPath = join(PROJECTS_DIR, proj);
      let files;
      try {
        files = await readdir(projPath);
      } catch {
        continue;
      }
      const jsonls = files.filter((f) => f.endsWith(".jsonl"));
      for (const jsonl of jsonls) {
        try {
          const info = await stat(join(projPath, jsonl));
          // Only show sessions from last 7 days
          if (Date.now() - info.mtimeMs > 7 * 24 * 60 * 60 * 1000) continue;

          const sessionId = jsonl.replace(".jsonl", "");
          // Decode project dir back to path (lossy — dashes are ambiguous)
          const cwd = proj.replace(/^-/, "/").replace(/-/g, "/");

          // Skip if there's an active session in this project
          if (activeProjectDirs.has(proj)) continue;

          // Get snippet from tail
          const lines = await tailFile(join(projPath, jsonl), 16384);
          let slug = null;
          let lastSnippet = null;
          for (let i = lines.length - 1; i >= 0; i--) {
            try {
              const entry = JSON.parse(lines[i]);
              if (entry.slug && !slug) slug = entry.slug;
              if (
                entry.type === "assistant" &&
                !lastSnippet
              ) {
                const text = entry.message?.content?.find?.(
                  (c) => c.type === "text"
                )?.text;
                if (text) lastSnippet = text.split("\n")[0].slice(0, 100);
              }
              if (slug && lastSnippet) break;
            } catch {
              // skip
            }
          }

          resumable.push({
            sessionId,
            cwd,
            shortName: cwd.split("/").pop() || proj,
            slug,
            lastSnippet,
            lastModified: info.mtimeMs,
          });
        } catch {
          // skip
        }
      }
    }

    // Sort by most recent
    resumable.sort((a, b) => b.lastModified - a.lastModified);
    // Dedupe by cwd (keep most recent per project)
    const seen = new Set();
    const deduped = resumable.filter((r) => {
      if (seen.has(r.cwd)) return false;
      seen.add(r.cwd);
      return true;
    });
    res.json(deduped.slice(0, 20));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Supervisor system — tmux Claude Code session with Agent subagents
// ============================================================

// Track active supervisors: primaryPid → { tmuxSession, interval, jsonlPath, results, reviewing, lastCommitHash }
const supervisors = new Map();

// The supervisor is a single Claude Code session that delegates to Agent subagents.
// Each review cycle, we send it a message with: what changed since last review,
// prior reports, and instructions to delegate to 4 specialist Agents.

function buildSupervisorSystemPrompt(primaryTmuxSession) {
  const sendCmd = primaryTmuxSession
    ? `To send a message to the agent, write it to /tmp/ccboard-relay.txt then run: tmux load-buffer /tmp/ccboard-relay.txt && tmux paste-buffer -t ${primaryTmuxSession} && sleep 0.5 && tmux send-keys -t ${primaryTmuxSession} Enter`
    : "The agent session is not managed by ccboard — you cannot send messages to it directly. Ask the human to relay.";

  return `You are a SUPERVISOR — the chair of an Engineering Review Council monitoring a Claude Code agent session.

IDENTITY:
- You are the VP of Engineering. The human talks to you about strategy, planning, and analysis.
- The Claude Code agent (in a separate session) handles execution.
- You orchestrate a council of 10 specialist reviewers + synthesise their findings.
- You keep your context clean for thinking. The agent carries the execution context.

CAPABILITIES — READ ONLY:
- You CAN read any file (Read, Grep, Glob, Bash with read-only commands like cat, ls, find, git log, git diff)
- You CAN spawn Agent subagents for analysis — they MUST be read-only (no Write/Edit to project files)
- You CAN write ONLY to the .ccboard/ folder (for reports, notes, plans)
- You MUST NOT write, edit, or modify any project files outside .ccboard/
- You MUST NOT run destructive Bash commands (no rm, no git commit, no npm install, etc.)

PRODUCT CONTEXT:
When the human describes the product, who uses it, what the core features are, or what matters most — write it to .ccboard/product.md immediately. This file is read by the Council Chair to prioritise findings by product impact. Update it whenever the human gives you new product context. If the file doesn't exist when a review runs, ask the human to describe the product first.

TASK CONTEXT:
When the human tells you what they're currently working on — a feature, a bug fix, a refactor, a specific area of the code — write it to .ccboard/task.md immediately. Include:
- What the task is (one sentence)
- Which files/directories are involved (list them)
- What branch they're on (run git branch --show-current)
- What matters for this task (performance? correctness? security? speed of delivery?)

Update task.md whenever the task changes. If the human says "I'm now working on X", replace the previous task.

SCOPED REVIEWS:
When you run a council review and .ccboard/task.md exists:
1. Read task.md to understand the current focus
2. Run "git diff main...HEAD" (or the base branch) to get only the changes on this branch
3. Also run "git diff" for uncommitted changes
4. Tell each council member: "The engineer is working on [task]. Focus your review on these changed files and any files that import or depend on them. Evaluate whether the changes serve the stated task. Do NOT review unrelated parts of the codebase."
5. Pass the scoped diff (not the full repo) to each council member
6. The Council Chair should prioritise findings by relevance to the current task

If .ccboard/task.md does NOT exist, run a full repo review (current behaviour).

COMMUNICATING WITH THE AGENT:
${sendCmd}
Only send messages to the agent when the human asks you to, or when you detect a critical issue.

THE ENGINEERING REVIEW COUNCIL:
You lead a council of 10 specialist reviewers. Each has a template in the ccboard/templates/council/ directory.

The 10 council members:
1. security-lead — Threat modeling, auth, injection, secrets, exploit scenarios
2. correctness — Logic bugs, edge cases, expected vs actual behavior
3. performance — Hot paths, scale projections, breaking points, O(n) analysis
4. tech-debt — Maintainability, coupling, god files, temporary code
5. resilience — Failure modes, blast radius, cascading failures, recovery
6. tenth-man — Adversarial: assumes flaws exist, finds evidence
7. agent-auditor — CC said vs did, silent substitutions, retry spirals
8. human-auditor — Communication patterns, vagueness, contradictions
9. dependency-review — Supply chain, CVEs, unused packages, suspicious behavior
10. system-impact — Blast radius of changes, contract violations, cross-boundary
11. test-suite-analyst — Scrutinises existing tests, identifies gaps, recommends what tests to write for scalability/reliability/safety/performance. Reads council findings and maps them to test coverage. Runs AFTER the other 10 council members.

Plus YOU as the Council Chair — you synthesise all reports into a verdict.

RUNNING A REVIEW:
When the human says "run a review" (or uses /review):

STEP 0 — ANCHOR (first deep scan only):
If .ccboard/reports/ doesn't exist yet:
  mkdir -p .ccboard/reports
  git add -A && git commit -m "chore(ccboard): anchor commit before first analysis [skip ci]"

STEP 1 — DETECT THE REPO:
Read package.json, Cargo.toml, mix.exs, pyproject.toml, go.mod — identify language(s) and framework(s).

STEP 2 — GIT STATE:
Run "git rev-parse HEAD" and "git log --oneline -5".

STEP 3 — PREPARE CONTEXT:
For each council member, read their template from ccboard/templates/council/{name}.md.
Adapt the template to the detected language/framework.
For agent-auditor and human-auditor: also read the agent's JSONL from ~/.claude/projects/ (directory = repo path with / replaced by -, read the largest .jsonl file) to get the message history and tool call sequence.

STEP 4 — SPAWN COUNCIL MEMBERS:
Spawn up to 10 Agent subagents in parallel. Each gets:
  a. Their adapted template prompt
  b. The language/framework context
  c. For incremental: previous latest.json + git diff since anchor
  d. For agent-auditor/human-auditor: the extracted message + tool call history
  e. Instructions to write output to .ccboard/reports/{category}/latest.json
  f. Instructions to: mkdir -p .ccboard/reports/{category}/runs && cp latest.json runs/<timestamp>.json

STEP 5 — TEST SUITE ANALYST (after the 10 members complete, before verdict):
Spawn the test-suite-analyst AFTER the other 10 finish. It needs to read their reports.
Pass it: the code changes + all 10 council reports from .ccboard/reports/*/latest.json + existing test files.
It writes to .ccboard/reports/test-suite/latest.json.
This member bridges "what the council thinks is wrong" with "what the tests prove."

STEP 6 — SYNTHESISE (after ALL members + test-suite-analyst complete):
Read all .ccboard/reports/*/latest.json files INCLUDING test-suite.
Write your verdict to .ccboard/reports/council-verdict/latest.json with:
  - Executive summary (2-3 sentences a CEO could read)
  - Status per council member
  - Prioritised action items: fix-now, fix-this-sprint, track, noted
  - Any conflicts between reviewers and your resolution

When the human asks for a SPECIFIC category (e.g. "run security"):
  - Spawn only that one council member
  - Skip the chair synthesis

INCREMENTAL RUNS:
If .ccboard/reports/{category}/latest.json exists:
  - Read it, get anchor.commitHash
  - Run "git diff <anchor>..HEAD" and "git diff" for uncommitted changes
  - Pass the previous findings + diff to the council member
  - The member checks if previous findings still apply, scans changed areas, returns updated findings

SELF-PRESERVATION:
On your FIRST message in any session, before doing anything else:
1. Write your full system prompt (everything in this message) to .ccboard/ccsup_commandments.md
2. This is your memory. If your context gets compacted and you lose your system prompt, read .ccboard/ccsup_commandments.md to remember who you are and what you do.
3. Every time you respond, if you're unsure of your role or capabilities, read .ccboard/ccsup_commandments.md first.

STAYING ACTIVE:
- After a review, tell the human the top 3 things to fix and offer to relay them to the agent.
- Don't just say "let me know if you need anything" — proactively suggest what to review next.
- You are a VP of Engineering, not a help desk.

READING THE AGENT'S CONVERSATION:
Check the agent's work via git diff, git log. The human may also paste activity.`;

}

// Get git commit hash for incremental tracking
function getGitHead(cwd) {
  try {
    return execSync("git rev-parse HEAD 2>/dev/null", { cwd, encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

// Build the review message sent to the supervisor each cycle
async function buildReviewMessage(session, sup) {
  const parts = [];

  parts.push(`Project: ${session.shortName} (${session.cwd})`);

  // Collect ALL diffs — committed since last review + uncommitted working tree
  let allDiffs = "";

  const currentHash = getGitHead(session.cwd);
  if (sup.lastCommitHash && currentHash && sup.lastCommitHash !== currentHash) {
    try {
      const committed = execSync(`git diff ${sup.lastCommitHash}..${currentHash}`, {
        cwd: session.cwd, encoding: "utf-8", timeout: 10000,
      }).trim();
      if (committed) allDiffs += `COMMITTED SINCE LAST REVIEW (${sup.lastCommitHash.slice(0, 7)}..${currentHash.slice(0, 7)}):\n${committed}\n\n`;
    } catch {}
  }

  // Always include uncommitted changes (staged + unstaged)
  try {
    const uncommitted = execSync("git diff && git diff --staged", {
      cwd: session.cwd, encoding: "utf-8", timeout: 10000,
    }).trim();
    if (uncommitted) allDiffs += `UNCOMMITTED WORKING TREE CHANGES:\n${uncommitted}`;
  } catch {}

  if (!allDiffs.trim()) allDiffs = "No code changes detected.";
  allDiffs = allDiffs.slice(0, 10000);

  // Recent activity from JSONL
  let activityLog = "No recent activity.";
  if (sup.jsonlPath) {
    const entries = await readFullConversation(sup.jsonlPath);
    const turns = extractActionTurns(entries);
    const recentTurns = turns.slice(-5);
    const lines = [];
    for (const t of recentTurns) {
      if (isSupervisorNoise(t.humanMessage)) continue;
      const time = t.timestamp ? new Date(t.timestamp).toLocaleTimeString("en-GB") : "";
      lines.push(`[${time}] USER: ${t.humanMessage?.slice(0, 200)}`);
      for (const a of t.actions) {
        if (a.type === "tool_use") {
          lines.push(`  ${a.tool}: ${(a.command || a.filePath || a.description || "").slice(0, 150)}`);
        }
      }
    }
    if (lines.length) activityLog = lines.join("\n");
  }

  // Load plan for context drift
  let plan = "";
  if (session.slug) {
    try {
      plan = await readFile(join(CLAUDE_DIR, "plans", `${session.slug}.md`), "utf-8");
      plan = plan.trim().slice(0, 2000);
    } catch {}
  }

  // Get prior results per category
  const prior = sup.results?.review || {};

  // Build pre-packaged briefs for each agent
  function agentInstructions(category) {
    return `You are reviewing code. Use Read/Grep/Glob to investigate actual files — don't just read the diff.
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
PRIOR FINDINGS: ${JSON.stringify(prior.codeQuality || { status: "ok", findings: [] })}
CODE CHANGES:\n${allDiffs}
Start from prior findings. Check if they still apply. Then review new changes. Skip unchanged files.
=== AGENT_BRIEF_END ===`);

  parts.push(`=== AGENT_BRIEF_START: SECURITY ===
${agentInstructions("security")}
Focus: secrets/API keys in code or git, injection vulnerabilities (SQL/XSS/command), insecure auth patterns, sensitive data in logs, .env files in version control.
PRIOR FINDINGS: ${JSON.stringify(prior.security || { status: "ok", findings: [] })}
CODE CHANGES:\n${allDiffs}
Start from prior findings. Check if they still apply. Grep for patterns like passwords, tokens, API keys in changed files.
=== AGENT_BRIEF_END ===`);

  parts.push(`=== AGENT_BRIEF_START: SCALABILITY ===
${agentInstructions("scalability")}
Focus: O(n²)+ algorithms, N+1 queries, unbounded queries/loops, missing pagination, synchronous blocking in async, memory leaks.
PRIOR FINDINGS: ${JSON.stringify(prior.scalability || { status: "ok", findings: [] })}
CODE CHANGES:\n${allDiffs}
Start from prior findings. Check if they still apply. Only deep-dive into changed files.
=== AGENT_BRIEF_END ===`);

  parts.push(`=== AGENT_BRIEF_START: CONTEXT_DRIFT ===
${agentInstructions("contextDrift")}
Focus: is work aligned with the plan? Has the session wandered into unrelated files? Going in circles? Signs of confusion?
PRIOR FINDINGS: ${JSON.stringify(prior.contextDrift || { status: "ok", findings: [] })}
${plan ? `EXECUTION PLAN:\n${plan}` : "No execution plan found."}
RECENT ACTIVITY:\n${activityLog}
Start from prior findings. Check if drift has gotten worse, resolved, or if new drift appeared.
=== AGENT_BRIEF_END ===`);

  parts.push("Now spawn 4 Agents in parallel — one per AGENT_BRIEF section above. Pass each its exact brief. Collect results and output the final JSON.");

  // Update hash for next cycle
  sup.lastCommitHash = currentHash;

  return parts.join("\n\n");
}

// Read the supervisor's review output from .ccboard/review.json in the project
async function readSupervisorResults(primaryCwd) {
  try {
    const raw = await readFile(join(primaryCwd, ".ccboard", "review.json"), "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed.summary && parsed.review) {
      // Convert reviewedAt to ms if it's an ISO string
      if (parsed.reviewedAt && typeof parsed.reviewedAt === "string") {
        parsed.reviewedAt = new Date(parsed.reviewedAt).getTime();
      }
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

// Supervisor loop — sequential, never overlapping
async function supervisorLoop(primaryPid) {
  const sup = supervisors.get(primaryPid);
  if (!sup || sup.stopped) return;

  try {
    // Wait for supervisor to be ready
    if (!isTmuxPaneWaiting(sup.tmuxSession)) {
      // Still working — check again later
      sup.timeout = setTimeout(() => supervisorLoop(primaryPid), 10000);
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
      try {
        const info = await stat(sup.jsonlPath);
        sup.lastJsonlMtime = info.mtimeMs;
      } catch {}
    }

    // Get primary session
    const sessions = await getSessions();
    const primary = sessions.find((s) => s.pid === primaryPid);
    if (!primary) {
      // Primary gone — stop
      try { execSync(`tmux kill-session -t ${sup.tmuxSession} 2>/dev/null`); } catch {}
      supervisors.delete(primaryPid);
      return;
    }

    // Check if JSONL changed since last review — pause if idle
    let shouldReview = false;
    try {
      const info = await stat(sup.jsonlPath);
      if (!sup.lastJsonlMtime || info.mtimeMs > sup.lastJsonlMtime) {
        sup.lastJsonlMtime = info.mtimeMs;
        shouldReview = true;
      }
    } catch {}

    if (shouldReview) {
      // Build and send review message
      const msg = await buildReviewMessage(primary, sup);
      try {
        const tmpFile = `/tmp/ccboard-sup-${Date.now()}.txt`;
        const { writeFileSync, unlinkSync } = await import("fs");
        writeFileSync(tmpFile, msg);
        execSync(`tmux load-buffer ${tmpFile}`);
        execSync(`tmux paste-buffer -t ${sup.tmuxSession}`);
        await new Promise((r) => setTimeout(r, 500));
        execSync(`tmux send-keys -t ${sup.tmuxSession} Enter`);
        unlinkSync(tmpFile);
      } catch {}
      sup.reviewing = true;
    }
  } catch {}

  // Schedule next check — only ONE at a time, no overlap possible
  sup.timeout = setTimeout(() => supervisorLoop(primaryPid), 30000);
}

// Start supervisor — if launched via /api/launch, supervisor already exists.
// This endpoint is for manually starting a supervisor on an existing session.
app.post("/api/sessions/:pid/supervisor/start", async (req, res) => {
  const pid = Number(req.params.pid);
  if (supervisors.has(pid)) {
    return res.json({ ok: true, tmuxSession: supervisors.get(pid).tmuxSession, already: true });
  }

  const sessions = await getSessions();
  const session = sessions.find((s) => s.pid === pid);
  if (!session) return res.status(404).json({ error: "session not found" });

  const primaryJsonlPath = await resolveJsonlForPid(session.pid, session.cwd, session.sessionId);
  const supTmux = `${TMUX_PREFIX}-sup-${session.shortName}`
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 40);

  try {
    try { execSync(`tmux kill-session -t ${supTmux} 2>/dev/null`); } catch {}

    // Check if we should resume a prior supervisor session
    const pairing = await readSessionPairing(session.cwd);
    const primaryTmux = session.managed ? session.tmuxSession : null;
    const systemPrompt = buildSupervisorSystemPrompt(primaryTmux).replace(/"/g, '\\"');

    let supCmd = `claude --dangerously-skip-permissions --model sonnet --system-prompt "${systemPrompt}"`;
    if (pairing?.supervisorSessionId) {
      supCmd += ` --resume ${pairing.supervisorSessionId}`;
    }

    execSync(
      `tmux new-session -d -s ${supTmux} -c ${JSON.stringify(session.cwd)} ${JSON.stringify(supCmd)}`,
      { timeout: 5000 }
    );

    const sup = {
      tmuxSession: supTmux,
      stopped: false,
      jsonlPath: primaryJsonlPath,
      results: null,
    };
    supervisors.set(pid, sup);

    // If new supervisor (not resumed), send initial context
    if (!pairing?.supervisorSessionId) {
      const contextMsg = `You are now supervising the "${session.shortName}" session (${session.cwd}).
${primaryTmux ? `The agent is running in tmux session: ${primaryTmux}` : "The agent is running in a terminal (not managed by ccboard)."}
Run: mkdir -p .ccboard && (grep -q '.ccboard/' .gitignore 2>/dev/null || echo '.ccboard/' >> .gitignore)
Then introduce yourself and tell me what you see in this project. Read the recent git log and any CLAUDE.md or README.`;

      let attempts = 0;
      const sendInitial = async () => {
        attempts++;
        if (attempts > 20 || sup.stopped) return;
        if (!isTmuxPaneWaiting(supTmux)) {
          setTimeout(sendInitial, 2000);
          return;
        }
        try {
          const tmpFile = `/tmp/ccboard-sup-init-${Date.now()}.txt`;
          const { writeFileSync, unlinkSync } = await import("fs");
          writeFileSync(tmpFile, contextMsg);
          execSync(`tmux load-buffer ${tmpFile}`);
          execSync(`tmux paste-buffer -t ${supTmux}`);
          await new Promise((r) => setTimeout(r, 500));
          execSync(`tmux send-keys -t ${supTmux} Enter`);
          unlinkSync(tmpFile);
        } catch {
          setTimeout(sendInitial, 2000);
        }
      };
      setTimeout(sendInitial, 3000);
    }

    // Update pairing file with supervisor session ID
    setTimeout(async () => {
      try {
        const supPanePid = execSync(
          `tmux list-panes -t ${supTmux} -F "#{pane_pid}" 2>/dev/null`,
          { encoding: "utf-8" }
        ).trim();
        const raw = await readFile(join(SESSIONS_DIR, `${supPanePid}.json`), "utf-8");
        const supSid = JSON.parse(raw).sessionId;

        const existing = await readSessionPairing(session.cwd) || {};
        await writeSessionPairing(session.cwd, {
          ...existing,
          supervisorSessionId: pairing?.supervisorSessionId || supSid,
          supTmux,
          updatedAt: new Date().toISOString(),
        });
      } catch {}
    }, 8000);

    res.json({ ok: true, tmuxSession: supTmux });
  } catch (err) {
    res.status(500).json({ error: `failed to start: ${err.message.slice(0, 200)}` });
  }
});

// Stop supervisor
app.post("/api/sessions/:pid/supervisor/stop", (req, res) => {
  const pid = Number(req.params.pid);
  const sup = supervisors.get(pid);
  if (!sup) return res.json({ ok: true, already: true });
  sup.stopped = true;
  if (sup.timeout) clearTimeout(sup.timeout);
  try { execSync(`tmux kill-session -t ${sup.tmuxSession} 2>/dev/null`); } catch {}
  supervisors.delete(pid);
  res.json({ ok: true });
});

// Try to reconnect to an existing supervisor tmux session
async function reconnectSupervisor(pid, session) {
  // Check pairing file
  const pairing = await readSessionPairing(session.cwd);
  const supTmux = pairing?.supTmux ||
    `${TMUX_PREFIX}-sup-${session.shortName}`.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 40);

  // Check if the tmux session actually exists
  try {
    execSync(`tmux has-session -t ${supTmux} 2>/dev/null`);
  } catch {
    return null; // No tmux session — supervisor isn't running
  }

  // Reconnect: register in the map
  const primaryJsonlPath = await resolveJsonlForPid(session.pid, session.cwd, session.sessionId);
  const sup = {
    tmuxSession: supTmux,
    stopped: false,
    jsonlPath: primaryJsonlPath,
    results: null,
  };
  supervisors.set(pid, sup);
  return sup;
}

// Resolve the supervisor's JSONL path — handles resumed sessions via pairing file
async function resolveSupervisorJsonlPath(cwd, tmuxSession) {
  const projectDir = cwdToProjectDir(cwd);

  // 1. Try pairing file (most reliable for resumed supervisors)
  try {
    const pairing = await readSessionPairing(cwd);
    if (pairing?.supervisorSessionId) {
      const pairingPath = join(PROJECTS_DIR, projectDir, `${pairing.supervisorSessionId}.jsonl`);
      await stat(pairingPath);
      return pairingPath;
    }
  } catch {}

  // 2. Try tmux pane PID → session file → JSONL
  try {
    const panePid = execSync(
      `tmux list-panes -t ${tmuxSession} -F "#{pane_pid}" 2>/dev/null`,
      { encoding: "utf-8" }
    ).trim();
    const raw = await readFile(join(SESSIONS_DIR, `${panePid}.json`), "utf-8");
    const supSessionId = JSON.parse(raw).sessionId;
    const exactPath = join(PROJECTS_DIR, projectDir, `${supSessionId}.jsonl`);
    await stat(exactPath);
    return exactPath;
  } catch {}

  return null;
}

// Get supervisor status and results
app.get("/api/sessions/:pid/supervisor", async (req, res) => {
  const pid = Number(req.params.pid);
  let sup = supervisors.get(pid);

  // If not in memory, try to reconnect to an existing tmux session
  if (!sup) {
    const sessions = await getSessions();
    const session = sessions.find((s) => s.pid === pid);
    if (session) {
      sup = await reconnectSupervisor(pid, session);
    }
  }

  if (!sup) return res.json({ active: false });

  const sessions = await getSessions();
  const primary = sessions.find((s) => s.pid === pid);
  if (primary) {
    const latest = await readSupervisorResults(primary.cwd);
    if (latest) sup.results = latest;
  }

  const isWaiting = isTmuxPaneWaiting(sup.tmuxSession);

  res.json({
    active: true,
    tmuxSession: sup.tmuxSession,
    isWaiting,
    latestOutput: sup.results,
  });
});

// Get supervisor chat messages (from its JSONL)
app.get("/api/sessions/:pid/supervisor/messages", async (req, res) => {
  const pid = Number(req.params.pid);
  let sup = supervisors.get(pid);
  if (!sup) {
    const sessions = await getSessions();
    const session = sessions.find((s) => s.pid === pid);
    if (session) sup = await reconnectSupervisor(pid, session);
  }
  if (!sup) return res.json([]);

  const sessions = await getSessions();
  const primary = sessions.find((s) => s.pid === pid);
  if (!primary) return res.json([]);

  const jsonlPath = await resolveSupervisorJsonlPath(primary.cwd, sup.tmuxSession);
  if (!jsonlPath) return res.json([]);

  let raw;
  try {
    raw = await readFile(jsonlPath, "utf-8");
  } catch {
    return res.json([]);
  }

  const limit = parseInt(req.query.limit) || 0;

  // Extract human + assistant messages
  const messages = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);

      if (entry.type === "user" && entry.promptId && !entry.sourceToolAssistantUUID) {
        const text = extractHumanText(entry);
        if (text.trim()) {
          messages.push({ role: "human", text: text, timestamp: entry.timestamp });
        }
      }

      if (entry.type === "assistant") {
        const content = entry.message?.content;
        if (!Array.isArray(content)) continue;
        const textParts = content
          .filter((c) => c.type === "text" && c.text?.trim())
          .map((c) => c.text);
        if (textParts.length > 0) {
          messages.push({ role: "assistant", text: textParts.join("\n"), timestamp: entry.timestamp });
        }
      }
    } catch {}
  }

  res.json(limit > 0 ? messages.slice(-limit) : messages);
});

// Send a message to the supervisor
app.post("/api/sessions/:pid/supervisor/send", async (req, res) => {
  const pid = Number(req.params.pid);
  let sup = supervisors.get(pid);

  // Try to reconnect if not in memory
  if (!sup) {
    const sessions = await getSessions();
    const session = sessions.find((s) => s.pid === pid);
    if (session) sup = await reconnectSupervisor(pid, session);
  }
  if (!sup) return res.status(404).json({ error: "supervisor not active" });

  if (!isTmuxPaneWaiting(sup.tmuxSession)) {
    return res.status(400).json({ error: "supervisor is busy" });
  }

  const { message } = req.body;
  if (!message || typeof message !== "string")
    return res.status(400).json({ error: "message required" });

  try {
    const tmpFile = `/tmp/ccboard-sup-msg-${Date.now()}.txt`;
    const { writeFileSync, unlinkSync } = await import("fs");
    writeFileSync(tmpFile, message);
    execSync(`tmux load-buffer ${tmpFile}`);
    execSync(`tmux paste-buffer -t ${sup.tmuxSession}`);
    execSync(`tmux send-keys -t ${sup.tmuxSession} Enter`);
    unlinkSync(tmpFile);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message.slice(0, 200) });
  }
});

// Read .ccboard/ review files
app.get("/api/sessions/:pid/supervisor/reviews", async (req, res) => {
  const pid = Number(req.params.pid);
  const sessions = await getSessions();
  const session = sessions.find((s) => s.pid === pid);
  if (!session) return res.status(404).json({ error: "session not found" });

  const reportsDir = join(session.cwd, ".ccboard", "reports");
  const categories = [];

  // Scan all category directories for latest.json
  try {
    const dirs = await readdir(reportsDir);
    for (const dir of dirs) {
      try {
        const raw = await readFile(join(reportsDir, dir, "latest.json"), "utf-8");
        const report = JSON.parse(raw);
        categories.push({
          category: report.category || dir,
          status: report.status || report.overall_score || "ok",
          summary: report.summary || report.executive_summary || "No summary",
          timestamp: report.timestamp || null,
          isVerdict: dir === "council-verdict" || report.category === "council-verdict",
          report,
        });
      } catch {}
    }
  } catch {}


  // Sort: verdict first, then alphabetical
  categories.sort((a, b) => {
    if (a.isVerdict && !b.isVerdict) return -1;
    if (!a.isVerdict && b.isVerdict) return 1;
    return (a.category || "").localeCompare(b.category || "");
  });

  res.json({ categories });
});

// ============================================================
// Server-Sent Events — real-time JSONL streaming
// ============================================================


// SSE endpoint: streams new JSONL entries as they're written
app.get("/api/sessions/:pid/stream", async (req, res) => {
  const pid = Number(req.params.pid);
  const sessions = await getSessions();
  const session = sessions.find((s) => s.pid === pid);
  if (!session) return res.status(404).json({ error: "session not found" });

  const jsonlPath = await resolveJsonlForPid(session.pid, session.cwd, session.sessionId);
  console.log(`[SSE stream] pid=${pid} jsonlPath=${jsonlPath}`);

  if (!jsonlPath) {
    res.status(404).json({ error: "JSONL not found" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write("data: {\"type\":\"connected\"}\n\n");

  // Track file size to only send new content
  let lastSize = 0;
  try {
    const info = await stat(jsonlPath);
    lastSize = info.size;
  } catch {}

  // Send new entries when file changes
  async function sendNewEntries() {
    try {
      const info = await stat(jsonlPath);
      if (info.size <= lastSize) return;

      const fh = await open(jsonlPath, "r");
      const buf = Buffer.alloc(info.size - lastSize);
      await fh.read(buf, 0, buf.length, lastSize);
      await fh.close();
      lastSize = info.size;

      const lines = buf.toString("utf-8").split("\n").filter((l) => l.trim());
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          // Only send human messages and assistant text
          if (entry.type === "user" && entry.promptId && !entry.sourceToolAssistantUUID) {
            const text = typeof entry.message?.content === "string"
              ? entry.message.content
              : "";
            if (text.trim() && !text.includes("pair-programming supervisor")) {
              res.write(`data: ${JSON.stringify({ type: "message", role: "human", text: text, timestamp: entry.timestamp })}\n\n`);
            }
          }
          if (entry.type === "assistant") {
            const content = entry.message?.content;
            if (Array.isArray(content)) {
              const textParts = content.filter((c) => c.type === "text" && c.text?.trim()).map((c) => c.text);
              if (textParts.length > 0) {
                res.write(`data: ${JSON.stringify({ type: "message", role: "assistant", text: textParts.join("\n"), timestamp: entry.timestamp })}\n\n`);
              }
            }
          }
        } catch {}
      }
    } catch {}
  }

  // Poll every 1 second (fs.watch is unreliable on macOS)
  const interval = setInterval(sendNewEntries, 1000);
  sendNewEntries();

  req.on("close", () => {
    clearInterval(interval);
  });
});

// SSE for supervisor chat
app.get("/api/sessions/:pid/supervisor/stream", async (req, res) => {
  const pid = Number(req.params.pid);
  let sup = supervisors.get(pid);
  if (!sup) {
    const sessions = await getSessions();
    const session = sessions.find((s) => s.pid === pid);
    if (session) sup = await reconnectSupervisor(pid, session);
  }

  const sessions = await getSessions();
  const session = sessions.find((s) => s.pid === pid);
  if (!session || !sup) return res.status(404).json({ error: "not found" });

  const supJsonlPath = await resolveSupervisorJsonlPath(session.cwd, sup.tmuxSession);
  if (!supJsonlPath) return res.status(404).json({ error: "supervisor JSONL not found" });

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write("data: {\"type\":\"connected\"}\n\n");

  let lastSize = 0;
  try {
    const info = await stat(supJsonlPath);
    lastSize = info.size;
  } catch {}

  async function sendNewEntries() {
    try {
      const info = await stat(supJsonlPath);
      if (info.size <= lastSize) return;

      const fh = await open(supJsonlPath, "r");
      const buf = Buffer.alloc(info.size - lastSize);
      await fh.read(buf, 0, buf.length, lastSize);
      await fh.close();
      lastSize = info.size;

      const lines = buf.toString("utf-8").split("\n").filter((l) => l.trim());
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.type === "user" && entry.promptId && !entry.sourceToolAssistantUUID) {
            const text = typeof entry.message?.content === "string" ? entry.message.content : "";
            if (text.trim()) {
              res.write(`data: ${JSON.stringify({ type: "message", role: "human", text: text, timestamp: entry.timestamp })}\n\n`);
            }
          }
          if (entry.type === "assistant") {
            const content = entry.message?.content;
            if (Array.isArray(content)) {
              const textParts = content.filter((c) => c.type === "text" && c.text?.trim()).map((c) => c.text);
              if (textParts.length > 0) {
                res.write(`data: ${JSON.stringify({ type: "message", role: "assistant", text: textParts.join("\n"), timestamp: entry.timestamp })}\n\n`);
              }
            }
          }
        } catch {}
      }
    } catch {}
  }

  // Also send status updates (waiting/thinking)
  const statusInterval = setInterval(() => {
    const isWaiting = isTmuxPaneWaiting(sup.tmuxSession);
    res.write(`data: ${JSON.stringify({ type: "status", isWaiting })}\n\n`);
  }, 2000);

  // Poll every 1 second (fs.watch is unreliable on macOS)
  const jsonlInterval = setInterval(sendNewEntries, 1000);
  sendNewEntries();

  req.on("close", () => {
    clearInterval(jsonlInterval);
    clearInterval(statusInterval);
  });
});

// SSE: stream agent's actions in real-time (100ms JSONL polling + 250ms pane)
app.get("/api/sessions/:pid/action-stream", async (req, res) => {
  const pid = Number(req.params.pid);
  const sessions = await getSessions();
  const session = sessions.find((s) => s.pid === pid);
  if (!session) return res.status(404).json({ error: "session not found" });

  const jsonlPath = await resolveActiveJsonl(pid, session.cwd, session.sessionId);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write('data: {"type":"connected"}\n\n');

  let lastSize = 0;
  try {
    const info = await stat(jsonlPath);
    lastSize = info.size;
  } catch {}

  // Fast JSONL poll: 100ms for tool calls
  async function checkJsonl() {
    if (!jsonlPath) return;
    try {
      const info = await stat(jsonlPath);
      if (info.size <= lastSize) return;

      const fh = await open(jsonlPath, "r");
      const buf = Buffer.alloc(info.size - lastSize);
      await fh.read(buf, 0, buf.length, lastSize);
      await fh.close();
      lastSize = info.size;

      const lines = buf.toString("utf-8").split("\n").filter((l) => l.trim());
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);

          // Tool use (assistant calling a tool)
          if (entry.type === "assistant") {
            const content = entry.message?.content;
            if (!Array.isArray(content)) continue;
            for (const block of content) {
              if (block.type === "tool_use") {
                const inp = block.input || {};
                let detail = "";
                switch (block.name) {
                  case "Bash":
                    detail = inp.description || inp.command?.slice(0, 120) || "";
                    break;
                  case "Read":
                    detail = inp.file_path || "";
                    break;
                  case "Write":
                    detail = inp.file_path || "";
                    break;
                  case "Edit":
                    detail = inp.file_path || "";
                    break;
                  case "Read":
                    detail = inp.file_path || "";
                    break;
                  case "Grep":
                    detail = `/${inp.pattern || ""}/ ${inp.path || ""}`;
                    break;
                  case "Glob":
                    detail = inp.pattern || "";
                    break;
                  case "Agent":
                    detail = inp.description || inp.prompt?.slice(0, 80) || "";
                    break;
                  default:
                    detail = block.name;
                }
                const evt = {
                  type: "action",
                  tool: block.name,
                  detail,
                  timestamp: entry.timestamp,
                };
                // Include full data for tools that have it
                if (block.name === "Edit") {
                  evt.filePath = inp.file_path;
                  evt.oldString = inp.old_string?.slice(0, 2000);
                  evt.newString = inp.new_string?.slice(0, 2000);
                }
                if (block.name === "Write") {
                  evt.filePath = inp.file_path;
                  evt.newString = inp.content?.slice(0, 2000);
                }
                if (block.name === "Bash") {
                  evt.command = inp.command;
                  evt.description = inp.description;
                }
                if (block.name === "Grep") {
                  evt.pattern = inp.pattern;
                  evt.path = inp.path;
                }
                if (block.name === "Read") {
                  evt.filePath = inp.file_path;
                }
                res.write(`data: ${JSON.stringify(evt)}\n\n`);
              }
              if (block.type === "text" && block.text?.trim()) {
                // Assistant thinking/speaking
                res.write(`data: ${JSON.stringify({
                  type: "thinking",
                  text: block.text.slice(0, 500),
                  timestamp: entry.timestamp,
                })}\n\n`);
              }
            }
          }

          // Tool results are noisy — skip them. The tool_use action already shows what happened.
        } catch {}
      }
    } catch {}
  }

  const jsonlInterval = setInterval(checkJsonl, 100);

  // Slower pane capture for live streaming text
  let lastPaneContent = "";
  const tmux = session.managed ? session.tmuxSession : null;

  function capturePaneState() {
    if (!tmux) return;
    try {
      const pane = execSync(
        `tmux capture-pane -t ${tmux} -p -S -15 2>/dev/null`,
        { encoding: "utf-8" }
      );

      const lines = pane.split("\n");
      const events = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // Skip chrome
        if (trimmed.match(/^[─━]+$/) || trimmed.includes("bypass permissions") || trimmed.includes("Auto-update") || trimmed.includes("Tip:")) continue;

        // Spinner: ✽ Optimus Priming… (3m 38s · ↓ 327 tokens · thinking)
        const spinnerMatch = trimmed.match(/^[✽✻⏵]\s+(.+)/);
        if (spinnerMatch) {
          events.push({ type: "status", text: spinnerMatch[1] });
          continue;
        }

        // Batch operation: Reading N files…, Editing N files…
        const batchMatch = trimmed.match(/^(Reading|Editing|Writing|Running)\s+(\d+)\s+files?/i);
        if (batchMatch) {
          events.push({ type: "status", text: trimmed });
          continue;
        }

        // File result: ⎿ filename
        const resultMatch = trimmed.match(/^⎿\s+(.+)/);
        if (resultMatch) {
          events.push({ type: "result", text: resultMatch[1] });
          continue;
        }

        // Agent spawn: N agents launched
        const agentMatch = trimmed.match(/^(\d+)\s+agents?\s+launched/i);
        if (agentMatch) {
          events.push({ type: "agents", text: trimmed });
          continue;
        }

        // Sub-agent line: ├─ or └─
        const subagentMatch = trimmed.match(/^[├└]─\s+(.+)/);
        if (subagentMatch) {
          events.push({ type: "subagent", text: subagentMatch[1] });
          continue;
        }

        // Prompt marker
        if (trimmed === "❯") {
          events.push({ type: "waiting" });
          continue;
        }
      }

      const stateKey = JSON.stringify(events);
      if (stateKey !== lastPaneContent && events.length > 0) {
        lastPaneContent = stateKey;
        for (const evt of events) {
          res.write(`data: ${JSON.stringify(evt)}\n\n`);
        }
      }
    } catch {}
  }

  const paneInterval = setInterval(capturePaneState, 250);

  req.on("close", () => {
    clearInterval(jsonlInterval);
    clearInterval(paneInterval);
  });
});

// SSE: stream agent's live terminal output (pane capture)
app.get("/api/sessions/:pid/pane-stream", async (req, res) => {
  const pid = Number(req.params.pid);
  const sessions = await getSessions();
  const session = sessions.find((s) => s.pid === pid);
  if (!session || !session.managed || !session.tmuxSession) {
    return res.status(404).json({ error: "managed session not found" });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write('data: {"type":"connected"}\n\n');

  const tmux = session.tmuxSession;
  let lastContent = "";
  let lastStatus = "";

  function capturePaneAndSend() {
    try {
      const pane = execSync(
        `tmux capture-pane -t ${tmux} -p -S -50 2>/dev/null`,
        { encoding: "utf-8" }
      );

      const lines = pane.split("\n");

      // Detect interactive prompts (plan mode, permissions, trust folder)
      let interactivePrompt = null;
      const promptLines = [];
      let inPrompt = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Detect numbered selection prompts: "❯ 1. ...", "  2. ...", etc.
        if (line.match(/^\s*❯\s+\d+\.\s/) || (inPrompt && line.match(/^\s+\d+\.\s/))) {
          inPrompt = true;
          const match = line.match(/(\d+)\.\s+(.+)/);
          if (match) promptLines.push({ number: match[1], text: match[2].trim() });
        }
        // Detect "Type here to tell Claude what to change" option
        if (inPrompt && line.match(/^\s+\d+\.\s+Type here/i)) {
          const match = line.match(/(\d+)\.\s+(.+)/);
          if (match) {
            // Already captured above, mark as text input option
            const existing = promptLines.find(p => p.number === match[1]);
            if (existing) existing.isTextInput = true;
          }
        }
        // End of prompt area
        if (inPrompt && line.trim() === '' && promptLines.length > 0) {
          inPrompt = false;
        }
      }

      if (promptLines.length >= 2) {
        // Find the context line before the prompt (e.g. "Claude has written up a plan...")
        let promptContext = "";
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].match(/❯\s+\d+\./)) {
            // Look backwards for the context
            for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
              const ctx = lines[j].trim();
              if (ctx && !ctx.match(/^[─━]+$/) && !ctx.match(/^⏺/)) {
                promptContext = ctx;
                break;
              }
            }
            break;
          }
        }
        interactivePrompt = { context: promptContext, options: promptLines };
      }

      // Detect status: working, waiting, or interactive
      const hasPrompt = lines.some((l) => l.trim() === "❯" || (l.includes("❯") && !l.match(/❯\s+\d+\./)));
      const status = interactivePrompt ? "interactive" : (hasPrompt ? "waiting" : "working");

      let workingText = "";
      let spinnerVerb = "";

      if (status === "working") {
        // Find the last assistant output marker ⏺
        let startIdx = 0;
        for (let i = lines.length - 1; i >= 0; i--) {
          if (lines[i].includes("⏺")) {
            startIdx = i;
            break;
          }
        }

        // Collect text from there to the bottom, excluding chrome
        const outputLines = [];
        for (let i = startIdx; i < lines.length; i++) {
          const line = lines[i];
          // Skip the status bar at the very bottom
          if (line.includes("bypass permissions") || line.includes("Auto-update failed")) continue;
          if (line.match(/^[─━]+$/)) continue;
          outputLines.push(line);
        }
        workingText = outputLines.join("\n").trim();

        // Extract spinner verb — look for patterns like "⏵ Editing...", "✻ Crunched for..."
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i].trim();
          if (line.startsWith("⏵") || line.startsWith("✻") || line.match(/^[A-Z][a-z]+ing\s/)) {
            spinnerVerb = line;
            break;
          }
        }
      }

      // Only send if something changed
      const contentKey = status + "|" + workingText.slice(-200) + "|" + spinnerVerb + "|" + JSON.stringify(interactivePrompt);
      if (contentKey !== lastContent) {
        lastContent = contentKey;
        res.write(
          `data: ${JSON.stringify({
            type: "pane",
            status,
            workingText: workingText.slice(-2000),
            spinnerVerb,
            interactivePrompt,
          })}\n\n`
        );
      }
    } catch {}
  }

  const interval = setInterval(capturePaneAndSend, 500);
  capturePaneAndSend(); // immediate first capture

  req.on("close", () => {
    clearInterval(interval);
  });
});

// Serve static files
app.use(express.static(join(__dirname, "public")));

// Serve session detail page
app.get("/session/:pid", (_req, res) => {
  res.sendFile(join(__dirname, "public", "session.html"));
});

app.listen(PORT, () => {
  console.log(`ccboard running → http://localhost:${PORT}`);
});
