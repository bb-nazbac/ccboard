/**
 * Supervisor API routes.
 * Ported from server.js supervisor endpoints.
 */

import { Router } from "express";
import { execSync } from "child_process";
import { readFile } from "fs/promises";
import { join } from "path";
import { TMUX_PREFIX, SESSIONS_DIR } from "../lib/constants.js";
import {
  isTmuxPaneWaiting,
  sendToTmuxSession,
} from "../services/tmux.js";
import {
  readSessionPairing,
  writeSessionPairing,
} from "../services/pairing.js";
import { resolveJsonlForPid } from "../services/jsonl-resolver.js";
import { getSessions } from "../services/session-reader.js";
import { buildSupervisorSystemPrompt } from "../services/supervisor-prompt.js";
import {
  supervisors,
  reconnectSupervisor,
  readSupervisorResults,
  resolveSupervisorJsonlPath,
  extractSupervisorMessages,
} from "../services/supervisor-manager.js";
import type { SupervisorState } from "../services/supervisor-manager.js";

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/sessions/:pid/supervisor -- supervisor status and results
// ---------------------------------------------------------------------------

router.get("/:pid/supervisor", async (req, res) => {
  const pid = Number(req.params.pid);
  let sup: SupervisorState | undefined | null = supervisors.get(pid);

  // If not in memory, try to reconnect to an existing tmux session
  if (!sup) {
    const sessions = await getSessions();
    const session = sessions.find((s) => s.pid === pid);
    if (session) {
      sup = await reconnectSupervisor(pid, session);
    }
  }

  if (!sup) {
    res.json({ active: false });
    return;
  }

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

// ---------------------------------------------------------------------------
// POST /api/sessions/:pid/supervisor/start -- launch supervisor
// ---------------------------------------------------------------------------

router.post("/:pid/supervisor/start", async (req, res) => {
  const pid = Number(req.params.pid);
  const existing = supervisors.get(pid);
  if (existing) {
    res.json({ ok: true, tmuxSession: existing.tmuxSession, already: true });
    return;
  }

  const sessions = await getSessions();
  const session = sessions.find((s) => s.pid === pid);
  if (!session) {
    res.status(404).json({ error: "session not found" });
    return;
  }

  const primaryJsonlPath = await resolveJsonlForPid(
    session.pid,
    session.cwd,
    session.sessionId,
  );
  const supTmux = `${TMUX_PREFIX}-sup-${session.shortName}`
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 40);

  try {
    try {
      execSync(`tmux kill-session -t ${supTmux} 2>/dev/null`);
    } catch {
      // may not exist
    }

    // Check if we should resume a prior supervisor session
    const pairing = await readSessionPairing(session.cwd);
    const primaryTmux = session.managed ? session.tmuxSession : null;
    const systemPrompt = buildSupervisorSystemPrompt(primaryTmux, session.cwd).replace(
      /"/g,
      '\\"',
    );

    let supCmd = `claude --dangerously-skip-permissions --model opus --system-prompt "${systemPrompt}"`;
    if (pairing?.supervisorSessionId) {
      supCmd += ` --resume ${pairing.supervisorSessionId}`;
    }

    execSync(
      `tmux new-session -d -s ${supTmux} -c ${JSON.stringify(session.cwd)} ${JSON.stringify(supCmd)}`,
      { timeout: 5000 },
    );

    const sup: SupervisorState = {
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
      const sendInitial = (): void => {
        attempts++;
        if (attempts > 20 || sup.stopped) return;
        if (!isTmuxPaneWaiting(supTmux)) {
          setTimeout(sendInitial, 2000);
          return;
        }
        try {
          sendToTmuxSession(supTmux, contextMsg);
        } catch {
          setTimeout(sendInitial, 2000);
        }
      };
      setTimeout(sendInitial, 3000);
    }

    // Update pairing file with supervisor session ID and PID
    setTimeout(() => {
      void (async () => {
        try {
          const supPanePid = execSync(
            `tmux list-panes -t ${supTmux} -F "#{pane_pid}" 2>/dev/null`,
            { encoding: "utf-8" },
          ).trim();
          const raw = await readFile(
            join(SESSIONS_DIR, `${supPanePid}.json`),
            "utf-8",
          );
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          const supSid = parsed.sessionId as string;

          const existingPairing = await readSessionPairing(session.cwd);
          await writeSessionPairing(session.cwd, {
            agentTmux: existingPairing?.agentTmux ?? "",
            supervisorTmux: supTmux,
            ...existingPairing,
            supervisorPid: Number(supPanePid) || undefined,
            supervisorSessionId:
              pairing?.supervisorSessionId ?? supSid,
          });
        } catch {
          // ignore -- pairing update is best-effort
        }
      })();
    }, 8000);

    res.json({ ok: true, tmuxSession: supTmux });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message.slice(0, 200) : "unknown error";
    res.status(500).json({ error: `failed to start: ${message}` });
  }
});

// ---------------------------------------------------------------------------
// POST /api/sessions/:pid/supervisor/stop -- kill supervisor
// ---------------------------------------------------------------------------

router.post("/:pid/supervisor/stop", (req, res) => {
  const pid = Number(req.params.pid);
  const sup = supervisors.get(pid);
  if (!sup) {
    res.json({ ok: true, already: true });
    return;
  }
  sup.stopped = true;
  if (sup.timeout) clearTimeout(sup.timeout);
  try {
    execSync(`tmux kill-session -t ${sup.tmuxSession} 2>/dev/null`);
  } catch {
    // ignore
  }
  supervisors.delete(pid);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// GET /api/sessions/:pid/supervisor/messages -- supervisor chat history
// ---------------------------------------------------------------------------

router.get("/:pid/supervisor/messages", async (req, res) => {
  const pid = Number(req.params.pid);
  let sup: SupervisorState | undefined | null = supervisors.get(pid);
  if (!sup) {
    const sessions = await getSessions();
    const session = sessions.find((s) => s.pid === pid);
    if (session) sup = await reconnectSupervisor(pid, session);
  }
  if (!sup) {
    res.json([]);
    return;
  }

  const sessions = await getSessions();
  const primary = sessions.find((s) => s.pid === pid);
  if (!primary) {
    res.json([]);
    return;
  }

  const jsonlPath = await resolveSupervisorJsonlPath(
    primary.cwd,
    sup.tmuxSession,
  );
  if (!jsonlPath) {
    res.json([]);
    return;
  }

  let raw: string;
  try {
    raw = await readFile(jsonlPath, "utf-8");
  } catch {
    res.json([]);
    return;
  }

  const limit =
    typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) || 0 : 0;

  res.json(extractSupervisorMessages(raw, limit));
});

// ---------------------------------------------------------------------------
// POST /api/sessions/:pid/supervisor/send -- send message to supervisor
// ---------------------------------------------------------------------------

router.post("/:pid/supervisor/send", async (req, res) => {
  const pid = Number(req.params.pid);
  let sup: SupervisorState | undefined | null = supervisors.get(pid);

  // Try to reconnect if not in memory
  if (!sup) {
    const sessions = await getSessions();
    const session = sessions.find((s) => s.pid === pid);
    if (session) sup = await reconnectSupervisor(pid, session);
  }
  if (!sup) {
    res.status(404).json({ error: "supervisor not active" });
    return;
  }

  if (!isTmuxPaneWaiting(sup.tmuxSession)) {
    res.status(400).json({ error: "supervisor is busy" });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const message = body.message;
  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "message required" });
    return;
  }

  try {
    sendToTmuxSession(sup.tmuxSession, message);
    res.json({ ok: true });
  } catch (err: unknown) {
    const errMsg =
      err instanceof Error ? err.message.slice(0, 200) : "unknown error";
    res.status(500).json({ error: errMsg });
  }
});

export default router;
