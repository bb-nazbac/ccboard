import { Router } from "express";
import type { Request, Response } from "express";
import { stat, open } from "fs/promises";
import { execSync } from "child_process";
import { getSessions } from "../services/session-reader.js";
import { resolveActiveJsonl } from "../services/jsonl-resolver.js";
import { supervisors, reconnectSupervisor, resolveSupervisorJsonlPath } from "../services/supervisor-manager.js";
import { isTmuxPaneWaiting } from "../services/tmux.js";

const router = Router();

// --- Helpers ---

function sseHeaders(res: Response) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
}

function send(res: Response, data: Record<string, unknown>) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/** Read new bytes from a file since lastSize, return parsed lines and new size */
async function readNewLines(filePath: string, lastSize: number): Promise<{ lines: string[]; newSize: number }> {
  const info = await stat(filePath);
  if (info.size <= lastSize) return { lines: [], newSize: lastSize };

  const fh = await open(filePath, "r");
  const buf = Buffer.alloc(info.size - lastSize);
  await fh.read(buf, 0, buf.length, lastSize);
  await fh.close();

  return {
    lines: buf.toString("utf-8").split("\n").filter((l) => l.trim()),
    newSize: info.size,
  };
}

/** Extract text from a JSONL user entry */
function extractUserText(entry: Record<string, unknown>): string {
  const msg = entry.message as Record<string, unknown> | undefined;
  if (!msg) return "";
  const content = msg.content;
  if (typeof content === "string") return content;
  return "";
}

/** Extract assistant text parts from a JSONL assistant entry */
function extractAssistantText(entry: Record<string, unknown>): string {
  const msg = entry.message as Record<string, unknown> | undefined;
  if (!msg) return "";
  const content = msg.content;
  if (!Array.isArray(content)) return "";
  const textParts = content
    .filter((c: Record<string, unknown>) => c.type === "text" && (c.text as string)?.trim())
    .map((c: Record<string, unknown>) => c.text as string);
  return textParts.join("\n");
}

// --- Agent message stream ---

router.get("/:pid/stream", async (req: Request, res: Response) => {
  const pid = Number(req.params.pid);
  const sessions = await getSessions();
  const session = sessions.find((s) => s.pid === pid);
  if (!session) { res.status(404).json({ error: "session not found" }); return; }

  const jsonlPathRaw = await resolveActiveJsonl(pid, session.cwd, session.sessionId);
  if (!jsonlPathRaw) { res.status(404).json({ error: "JSONL not found" }); return; }
  const jsonlPath = jsonlPathRaw; // narrow to string

  sseHeaders(res);
  send(res, { type: "connected" });

  let lastSize = 0;
  try { lastSize = (await stat(jsonlPath)).size; } catch {}

  async function sendNewEntries() {
    try {
      const { lines, newSize } = await readNewLines(jsonlPath, lastSize);
      lastSize = newSize;

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as Record<string, unknown>;
          if (entry.type === "user" && entry.promptId && !entry.sourceToolAssistantUUID) {
            const text = extractUserText(entry);
            if (text.trim() && !text.includes("pair-programming supervisor")) {
              send(res, { type: "message", role: "human", text, timestamp: entry.timestamp });
            }
          }
          if (entry.type === "assistant") {
            const text = extractAssistantText(entry);
            if (text) send(res, { type: "message", role: "assistant", text, timestamp: entry.timestamp });
          }
        } catch {}
      }
    } catch {}
  }

  const interval = setInterval(sendNewEntries, 1000);
  sendNewEntries();
  req.on("close", () => clearInterval(interval));
});

// --- Supervisor stream ---

router.get("/:pid/supervisor/stream", async (req: Request, res: Response) => {
  const pid = Number(req.params.pid);
  let sup = supervisors.get(pid) ?? undefined;
  if (!sup) {
    const sessions = await getSessions();
    const session = sessions.find((s) => s.pid === pid);
    if (session) sup = (await reconnectSupervisor(pid, session)) ?? undefined;
  }

  const sessions = await getSessions();
  const session = sessions.find((s) => s.pid === pid);
  if (!session || !sup) { res.status(404).json({ error: "not found" }); return; }

  const supJsonlPathRaw = await resolveSupervisorJsonlPath(session.cwd, sup.tmuxSession);
  if (!supJsonlPathRaw) { res.status(404).json({ error: "supervisor JSONL not found" }); return; }
  const supJsonlPath = supJsonlPathRaw;

  sseHeaders(res);
  send(res, { type: "connected" });

  let lastSize = 0;
  try { lastSize = (await stat(supJsonlPath)).size; } catch {}

  async function sendNewEntries() {
    try {
      const { lines, newSize } = await readNewLines(supJsonlPath, lastSize);
      lastSize = newSize;

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as Record<string, unknown>;
          if (entry.type === "user" && entry.promptId && !entry.sourceToolAssistantUUID) {
            const text = extractUserText(entry);
            if (text.trim()) send(res, { type: "message", role: "human", text, timestamp: entry.timestamp });
          }
          if (entry.type === "assistant") {
            const text = extractAssistantText(entry);
            if (text) send(res, { type: "message", role: "assistant", text, timestamp: entry.timestamp });
          }
        } catch {}
      }
    } catch {}
  }

  const tmuxSession = sup.tmuxSession;
  const statusInterval = setInterval(() => {
    send(res, { type: "status", isWaiting: isTmuxPaneWaiting(tmuxSession) });
  }, 2000);

  const jsonlInterval = setInterval(sendNewEntries, 1000);
  sendNewEntries();

  req.on("close", () => {
    clearInterval(jsonlInterval);
    clearInterval(statusInterval);
  });
});

// --- Action stream (fast JSONL poll + pane capture) ---

router.get("/:pid/action-stream", async (req: Request, res: Response) => {
  const pid = Number(req.params.pid);
  const sessions = await getSessions();
  const session = sessions.find((s) => s.pid === pid);
  if (!session) { res.status(404).json({ error: "session not found" }); return; }

  const jsonlPath = await resolveActiveJsonl(pid, session.cwd, session.sessionId);

  sseHeaders(res);
  send(res, { type: "connected" });

  let lastSize = 0;
  try { if (jsonlPath) lastSize = (await stat(jsonlPath)).size; } catch {}

  async function checkJsonl() {
    if (!jsonlPath) return;
    try {
      const { lines, newSize } = await readNewLines(jsonlPath, lastSize);
      lastSize = newSize;

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as Record<string, unknown>;
          if (entry.type !== "assistant") continue;
          const msg = entry.message as Record<string, unknown> | undefined;
          const content = msg?.content;
          if (!Array.isArray(content)) continue;

          for (const block of content as Record<string, unknown>[]) {
            if (block.type === "tool_use") {
              const inp = (block.input ?? {}) as Record<string, string>;
              const name = block.name as string;
              let detail = "";
              switch (name) {
                case "Bash": detail = inp.description ?? inp.command?.slice(0, 120) ?? ""; break;
                case "Read": case "Write": case "Edit": detail = inp.file_path ?? ""; break;
                case "Grep": detail = `/${inp.pattern ?? ""}/ ${inp.path ?? ""}`; break;
                case "Glob": detail = inp.pattern ?? ""; break;
                case "Agent": detail = inp.description ?? inp.prompt?.slice(0, 80) ?? ""; break;
                default: detail = name;
              }

              const evt: Record<string, unknown> = {
                type: "action", tool: name, detail, timestamp: entry.timestamp,
              };
              if (name === "Edit") { evt.filePath = inp.file_path; evt.oldString = inp.old_string?.slice(0, 2000); evt.newString = inp.new_string?.slice(0, 2000); }
              if (name === "Write") { evt.filePath = inp.file_path; evt.newString = inp.content?.slice(0, 2000); }
              if (name === "Bash") { evt.command = inp.command; evt.description = inp.description; }
              if (name === "Grep") { evt.pattern = inp.pattern; evt.path = inp.path; }
              if (name === "Read") { evt.filePath = inp.file_path; }
              send(res, evt);
            }
            if (block.type === "text" && (block.text as string)?.trim()) {
              send(res, { type: "thinking", text: (block.text as string).slice(0, 500), timestamp: entry.timestamp });
            }
          }
        } catch {}
      }
    } catch {}
  }

  const jsonlInterval = setInterval(checkJsonl, 100);

  // Pane capture for live status
  let lastPaneContent = "";
  const tmux = session.managed ? session.tmuxSession : null;

  function capturePaneState() {
    if (!tmux) return;
    try {
      const pane = execSync(`tmux capture-pane -t ${tmux} -p -S -15 2>/dev/null`, { encoding: "utf-8" });
      const lines = pane.split("\n");
      const events: Record<string, unknown>[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.match(/^[─━]+$/) || trimmed.includes("bypass permissions") || trimmed.includes("Auto-update") || trimmed.includes("Tip:")) continue;

        const spinnerMatch = trimmed.match(/^[✽✻⏵]\s+(.+)/);
        if (spinnerMatch?.[1]) { events.push({ type: "status", text: spinnerMatch[1] }); continue; }

        if (trimmed.match(/^(Reading|Editing|Writing|Running)\s+\d+\s+files?/i)) { events.push({ type: "status", text: trimmed }); continue; }

        const resultMatch = trimmed.match(/^⎿\s+(.+)/);
        if (resultMatch?.[1]) { events.push({ type: "result", text: resultMatch[1] }); continue; }

        if (trimmed.match(/^\d+\s+agents?\s+launched/i)) { events.push({ type: "agents", text: trimmed }); continue; }

        const subagentMatch = trimmed.match(/^[├└]─\s+(.+)/);
        if (subagentMatch?.[1]) { events.push({ type: "subagent", text: subagentMatch[1] }); continue; }

        if (trimmed === "❯") { events.push({ type: "waiting" }); continue; }
      }

      const stateKey = JSON.stringify(events);
      if (stateKey !== lastPaneContent && events.length > 0) {
        lastPaneContent = stateKey;
        for (const evt of events) send(res, evt);
      }
    } catch {}
  }

  const paneInterval = setInterval(capturePaneState, 250);

  req.on("close", () => {
    clearInterval(jsonlInterval);
    clearInterval(paneInterval);
  });
});

// --- Pane stream (live terminal output) ---

router.get("/:pid/pane-stream", async (req: Request, res: Response) => {
  const pid = Number(req.params.pid);
  const sessions = await getSessions();
  const session = sessions.find((s) => s.pid === pid);
  if (!session?.managed || !session.tmuxSession) {
    res.status(404).json({ error: "managed session not found" });
    return;
  }

  sseHeaders(res);
  send(res, { type: "connected" });

  const tmux = session.tmuxSession;
  let lastContent = "";

  function capturePaneAndSend() {
    try {
      const pane = execSync(`tmux capture-pane -t ${tmux} -p -S -50 2>/dev/null`, { encoding: "utf-8" });
      const lines = pane.split("\n");

      // Detect interactive prompts
      interface PromptLine { number: string; text: string; isTextInput?: boolean }
      const promptLines: PromptLine[] = [];
      let inPrompt = false;
      for (const line of lines) {
        if (line.match(/^\s*❯\s+\d+\.\s/) || (inPrompt && line.match(/^\s+\d+\.\s/))) {
          inPrompt = true;
          const match = line.match(/(\d+)\.\s+(.+)/);
          if (match?.[1] && match[2]) {
            const isTextInput = /Type here/i.test(match[2]);
            promptLines.push({ number: match[1], text: match[2].trim(), isTextInput });
          }
        }
        if (inPrompt && line.trim() === "" && promptLines.length > 0) inPrompt = false;
      }

      let interactivePrompt: { context: string; options: PromptLine[] } | null = null;
      if (promptLines.length >= 2) {
        let promptContext = "";
        for (let i = 0; i < lines.length; i++) {
          if (lines[i]?.match(/❯\s+\d+\./)) {
            for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
              const ctx = lines[j]?.trim();
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

      const hasPrompt = lines.some((l) => l.trim() === "❯" || (l.includes("❯") && !l.match(/❯\s+\d+\./)));
      const status = interactivePrompt ? "interactive" : hasPrompt ? "waiting" : "working";

      let workingText = "";
      let spinnerVerb = "";

      if (status === "working") {
        let startIdx = 0;
        for (let i = lines.length - 1; i >= 0; i--) {
          if (lines[i]?.includes("⏺")) { startIdx = i; break; }
        }
        const outputLines: string[] = [];
        for (let i = startIdx; i < lines.length; i++) {
          const line = lines[i] ?? "";
          if (line.includes("bypass permissions") || line.includes("Auto-update failed")) continue;
          if (line.match(/^[─━]+$/)) continue;
          outputLines.push(line);
        }
        workingText = outputLines.join("\n").trim();

        for (let i = lines.length - 1; i >= 0; i--) {
          const line = (lines[i] ?? "").trim();
          if (line.startsWith("⏵") || line.startsWith("✻") || line.match(/^[A-Z][a-z]+ing\s/)) {
            spinnerVerb = line;
            break;
          }
        }
      }

      const contentKey = status + "|" + workingText.slice(-200) + "|" + spinnerVerb + "|" + JSON.stringify(interactivePrompt);
      if (contentKey !== lastContent) {
        lastContent = contentKey;
        send(res, {
          type: "pane",
          status,
          workingText: workingText.slice(-2000),
          spinnerVerb,
          interactivePrompt,
        });
      }
    } catch {}
  }

  const interval = setInterval(capturePaneAndSend, 500);
  capturePaneAndSend();
  req.on("close", () => clearInterval(interval));
});

export default router;
