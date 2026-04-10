import { Router } from "express";
import { execSync } from "child_process";
import { getSessions } from "../services/session-reader.js";
import { resolveJsonlForPid } from "../services/jsonl-resolver.js";
import { readFullConversation, tailFile } from "../services/jsonl-parser.js";
import {
  extractActionTurns,
  extractMessageChain,
  extractContextInfo,
} from "../services/action-extractor.js";
import { findTmuxSessionForPid, sendToTmuxSession } from "../services/tmux.js";
import type { Session } from "../schemas/session.js";

const router = Router();

/** Look up a session by PID from the live session list */
async function findSession(pid: number): Promise<Session | undefined> {
  const sessions = await getSessions();
  return sessions.find((s) => s.pid === pid);
}

// GET /api/sessions — list all active sessions
router.get("/", async (_req, res) => {
  const sessions = await getSessions();
  res.json(sessions);
});

// GET /api/sessions/:pid/files — file tree for a session's cwd
router.get("/:pid/files", async (req, res) => {
  const session = await findSession(Number(req.params.pid));
  if (!session) { res.status(404).json({ error: "session not found" }); return; }

  try {
    const output = execSync(
      "git ls-files 2>/dev/null || find . -type f -not -path '*/node_modules/*' -not -path '*/.git/*' | head -500",
      { cwd: session.cwd, encoding: "utf-8", timeout: 5000 },
    ).trim();
    res.json(output.split("\n").filter((f) => f.trim()));
  } catch {
    res.json([]);
  }
});

// GET /api/sessions/:pid/diff — git diff (unstaged + staged)
router.get("/:pid/diff", async (req, res) => {
  const session = await findSession(Number(req.params.pid));
  if (!session) { res.status(404).json({ error: "session not found" }); return; }

  let diff = "";
  let staged = "";
  try {
    diff = execSync("git diff", { cwd: session.cwd, encoding: "utf-8", timeout: 10000 }).trim();
  } catch { /* empty */ }
  try {
    staged = execSync("git diff --staged", { cwd: session.cwd, encoding: "utf-8", timeout: 10000 }).trim();
  } catch { /* empty */ }

  res.json({ diff, staged });
});

// GET /api/sessions/:pid/actions — recent actions grouped by turn
router.get("/:pid/actions", async (req, res) => {
  const session = await findSession(Number(req.params.pid));
  if (!session) { res.status(404).json({ error: "session not found" }); return; }

  const limit = Number(req.query.limit) || 20;

  const jsonlPath = await resolveJsonlForPid(session.pid, session.cwd, session.sessionId);
  if (!jsonlPath) { res.json([]); return; }

  // Read last 128KB — enough for ~20 turns of actions
  const lines = await tailFile(jsonlPath, 128 * 1024);
  const entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const turns = extractActionTurns(entries);
  res.json(turns.slice(-limit));
});

// GET /api/sessions/:pid/messages — flat message chain
router.get("/:pid/messages", async (req, res) => {
  const session = await findSession(Number(req.params.pid));
  if (!session) { res.status(404).json({ error: "session not found" }); return; }

  const limit = Number(req.query.limit) || 100;

  // Use tailFile for limited reads (much faster than reading full JSONL)
  const jsonlPath = await resolveJsonlForPid(session.pid, session.cwd, session.sessionId);
  if (!jsonlPath) { res.json([]); return; }

  // Read last 256KB — enough for ~100 messages
  const lines = await tailFile(jsonlPath, 256 * 1024);
  const entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const messages = extractMessageChain(entries);
  res.json(messages.slice(-limit));
});

// GET /api/sessions/:pid/context — context window info (token usage, turns, etc.)
router.get("/:pid/context", async (req, res) => {
  const session = await findSession(Number(req.params.pid));
  if (!session) { res.status(404).json({ error: "session not found" }); return; }

  const jsonlPath = await resolveJsonlForPid(session.pid, session.cwd, session.sessionId);
  if (!jsonlPath) { res.json({}); return; }

  const entries = await readFullConversation(jsonlPath);
  const context = extractContextInfo(entries);
  res.json(context);
});

// POST /api/sessions/:pid/send — send a message to a tmux-managed session
router.post("/:pid/send", async (req, res) => {
  const session = await findSession(Number(req.params.pid));
  if (!session) { res.status(404).json({ error: "session not found" }); return; }
  if (session.status !== "waiting") {
    res.status(400).json({ error: "session is not waiting for input" });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const message = body.message;
  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "message required" });
    return;
  }

  const tmuxSession = findTmuxSessionForPid(session.pid);
  if (!tmuxSession) {
    res.status(400).json({
      error:
        "this session was not launched through ccboard — only ccboard-launched sessions support sending messages",
    });
    return;
  }

  try {
    sendToTmuxSession(tmuxSession, message);
    res.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message.slice(0, 200) : "unknown error";
    res.status(500).json({ error: `failed to send: ${msg}` });
  }
});

// POST /api/sessions/:pid/kill — terminate a Claude session
router.post("/:pid/kill", async (req, res) => {
  const session = await findSession(Number(req.params.pid));
  if (!session) { res.status(404).json({ error: "session not found" }); return; }

  try {
    process.kill(session.pid, "SIGTERM");
    res.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message.slice(0, 200) : "unknown error";
    res.status(500).json({ error: `failed to kill: ${msg}` });
  }
});

export default router;
