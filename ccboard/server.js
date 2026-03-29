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

// Determine session status combining process state + JSONL context
function inferStatus(proc, context) {
  if (!proc) return "dead";

  // High CPU = actively working right now
  if (proc.cpu > 5) return "working";

  // JSONL says Claude finished its turn → waiting for user input
  if (context?.isWaitingForUser) return "waiting";

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
      const status = inferStatus(proc, context);

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

// API
app.get("/api/sessions", async (_req, res) => {
  const sessions = await getSessions();
  res.json(sessions);
});

// Serve static files
app.use(express.static(join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`ccboard running → http://localhost:${PORT}`);
});
