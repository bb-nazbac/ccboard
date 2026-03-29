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

// Find the most recently modified JSONL in a project directory
async function findLatestJsonl(projectDir) {
  const dirPath = join(PROJECTS_DIR, projectDir);
  let files;
  try {
    files = await readdir(dirPath);
  } catch {
    return null;
  }
  const jsonls = files.filter((f) => f.endsWith(".jsonl"));
  if (jsonls.length === 0) return null;

  // Find the most recently modified one
  let latest = null;
  let latestMtime = 0;
  for (const f of jsonls) {
    try {
      const info = await stat(join(dirPath, f));
      if (info.mtimeMs > latestMtime) {
        latestMtime = info.mtimeMs;
        latest = f;
      }
    } catch {
      // skip
    }
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
    jsonlPath = await findLatestJsonl(projectDir);
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

      // Get rich context from JSONL
      const context = await getSessionContext(cwd, data.sessionId);

      // Check if this session is in a ccboard-managed tmux session
      const tmuxSession = findTmuxSessionForPid(data.pid);
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

// Extract the action log since the last human message
function extractActionLog(entries) {
  // Find the last human-typed message index
  let lastHumanIdx = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.type === "user" && e.promptId && !e.sourceToolAssistantUUID) {
      lastHumanIdx = i;
      break;
    }
  }

  // If no human message found, show last 50 entries
  const startIdx = lastHumanIdx >= 0 ? lastHumanIdx : Math.max(0, entries.length - 50);

  const actions = [];
  for (let i = startIdx; i < entries.length; i++) {
    const e = entries[i];

    // Human message
    if (e.type === "user" && e.promptId && !e.sourceToolAssistantUUID) {
      const content = e.message?.content;
      const text =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content
                .filter((c) => c.type === "text")
                .map((c) => c.text)
                .join("\n")
            : "";
      if (text.trim()) {
        actions.push({
          type: "human_message",
          text: text.slice(0, 2000),
          timestamp: e.timestamp,
        });
      }
    }

    // Assistant text or tool use
    if (e.type === "assistant") {
      const content = e.message?.content;
      if (!Array.isArray(content)) continue;

      for (const block of content) {
        if (block.type === "text" && block.text?.trim()) {
          actions.push({
            type: "assistant_text",
            text: block.text.slice(0, 2000),
            timestamp: e.timestamp,
          });
        }
        if (block.type === "tool_use") {
          const action = {
            type: "tool_use",
            tool: block.name,
            timestamp: e.timestamp,
          };
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
              break;
            case "Edit":
              action.filePath = inp.file_path;
              action.oldString = inp.old_string?.slice(0, 200);
              action.newString = inp.new_string?.slice(0, 200);
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
          actions.push(action);
        }
      }
    }
  }

  return actions;
}

// Build conversation message chain (human + assistant text only, no tool internals)
function extractMessageChain(entries) {
  const messages = [];

  for (const e of entries) {
    // Human messages
    if (e.type === "user" && e.promptId && !e.sourceToolAssistantUUID) {
      const content = e.message?.content;
      const text =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content
                .filter((c) => c.type === "text")
                .map((c) => c.text)
                .join("\n")
            : "";
      if (text.trim()) {
        messages.push({
          role: "human",
          text: text.slice(0, 5000),
          timestamp: e.timestamp,
        });
      }
    }

    // Assistant text responses (not tool calls)
    if (e.type === "assistant") {
      const content = e.message?.content;
      if (!Array.isArray(content)) continue;
      const textParts = content
        .filter((c) => c.type === "text" && c.text?.trim())
        .map((c) => c.text);
      if (textParts.length > 0) {
        messages.push({
          role: "assistant",
          text: textParts.join("\n").slice(0, 5000),
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

// Session detail: action log since last human message
app.get("/api/sessions/:pid/actions", async (req, res) => {
  const sessions = await getSessions();
  const session = sessions.find((s) => s.pid === Number(req.params.pid));
  if (!session) return res.status(404).json({ error: "session not found" });

  const jsonlPath = await resolveJsonlPath(session.cwd, session.sessionId);
  if (!jsonlPath) return res.json([]);

  const entries = await readFullConversation(jsonlPath);
  const actions = extractActionLog(entries);
  res.json(actions);
});

// Session detail: message chain
app.get("/api/sessions/:pid/messages", async (req, res) => {
  const sessions = await getSessions();
  const session = sessions.find((s) => s.pid === Number(req.params.pid));
  if (!session) return res.status(404).json({ error: "session not found" });

  const jsonlPath = await resolveJsonlPath(session.cwd, session.sessionId);
  if (!jsonlPath) return res.json([]);

  const entries = await readFullConversation(jsonlPath);
  const messages = extractMessageChain(entries);
  res.json(messages);
});

// Session detail: context window info
app.get("/api/sessions/:pid/context", async (req, res) => {
  const sessions = await getSessions();
  const session = sessions.find((s) => s.pid === Number(req.params.pid));
  if (!session) return res.status(404).json({ error: "session not found" });

  const jsonlPath = await resolveJsonlPath(session.cwd, session.sessionId);
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

// Launch a new Claude Code session in a tmux session
app.post("/api/launch", (req, res) => {
  const { cwd, resume, sessionId, name } = req.body;
  if (!cwd) return res.status(400).json({ error: "cwd required" });

  // Generate a session name
  const dirName = cwd.split("/").pop() || "session";
  const idx = getManagedTmuxSessions().length;
  const tmuxName = `${TMUX_PREFIX}-${idx}-${dirName}`
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 40);

  // Build the claude command
  let claudeCmd = "claude";
  if (resume && sessionId) {
    claudeCmd += ` --resume ${sessionId}`;
  } else if (resume) {
    claudeCmd += " --continue";
  }
  if (name) {
    claudeCmd += ` --name ${JSON.stringify(name)}`;
  }

  try {
    // Create a detached tmux session running claude in the given directory
    execSync(
      `tmux new-session -d -s ${tmuxName} -c ${JSON.stringify(cwd)} ${JSON.stringify(claudeCmd)}`,
      { timeout: 5000 }
    );
    res.json({ ok: true, tmuxSession: tmuxName });
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

// Serve static files
app.use(express.static(join(__dirname, "public")));

// Serve session detail page
app.get("/session/:pid", (_req, res) => {
  res.sendFile(join(__dirname, "public", "session.html"));
});

app.listen(PORT, () => {
  console.log(`ccboard running → http://localhost:${PORT}`);
});
