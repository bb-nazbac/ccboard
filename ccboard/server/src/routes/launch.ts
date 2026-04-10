import { Router } from "express";
import { execSync } from "child_process";
import { readFile, readdir, stat } from "fs/promises";
import { join } from "path";
import { getSessions } from "../services/session-reader.js";
import { findLargestJsonl } from "../services/jsonl-resolver.js";
import { tailFile } from "../services/jsonl-parser.js";
import {
  isTmuxPaneWaiting,
  sendToTmuxSession,
} from "../services/tmux.js";
import {
  cwdToProjectDir,
  readSessionPairing,
  writeSessionPairing,
  detectJsonlForRole,
} from "../services/pairing.js";
import { createLogger } from "../lib/logger.js";
import { buildSupervisorSystemPrompt } from "../services/supervisor-prompt.js";
import {
  TMUX_PREFIX,
  SESSIONS_DIR,
  PROJECTS_DIR,
} from "../lib/constants.js";

const log = createLogger("launch");
const router = Router();

/**
 * In-memory supervisor tracking: agent PID -> supervisor metadata.
 * Exported so other routes can access it if needed.
 */
export interface SupervisorEntry {
  tmuxSession: string;
  stopped: boolean;
  jsonlPath: string | null;
  results: unknown;
}
export const supervisors = new Map<number, SupervisorEntry>();

// Use the canonical prompt builder — no local copy

// POST /api/launch — launch a new Claude Code agent + supervisor in tmux
router.post("/launch", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const cwd = body.cwd as string | undefined;
  const resume = body.resume as boolean | undefined;
  const sessionId = body.sessionId as string | undefined;
  const name = body.name as string | undefined;

  if (!cwd) { res.status(400).json({ error: "cwd required" }); return; }

  const dirName = cwd.split("/").pop() || "session";
  const agentTmux = `${TMUX_PREFIX}-${dirName}`
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 40);
  const supTmux = `${TMUX_PREFIX}-sup-${dirName}`
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 40);

  try {
    // Kill existing if names collide
    try { execSync(`tmux kill-session -t ${agentTmux} 2>/dev/null`); } catch { /* empty */ }
    try { execSync(`tmux kill-session -t ${supTmux} 2>/dev/null`); } catch { /* empty */ }

    // Check for existing pairing (for resume)
    const pairing = await readSessionPairing(cwd);

    // Build agent command
    let agentCmd = "claude --dangerously-skip-permissions --model opus";
    if (resume && sessionId) {
      agentCmd += ` --resume ${sessionId}`;
    } else if (resume && pairing) {
      const pairingRec = pairing as unknown as Record<string, unknown>;
      const agentSid = pairingRec.agentSessionId as string | undefined;
      if (agentSid) agentCmd += ` --resume ${agentSid}`;
      else agentCmd += " --continue";
    } else if (resume) {
      agentCmd += " --continue";
    }
    if (name) {
      agentCmd += ` --name ${JSON.stringify(name)}`;
    }

    // Launch agent
    execSync(
      `tmux new-session -d -s ${agentTmux} -c ${JSON.stringify(cwd)} ${JSON.stringify(agentCmd)}`,
      { timeout: 5000 },
    );

    // Build supervisor command
    const systemPrompt = buildSupervisorSystemPrompt(agentTmux, cwd).replace(/"/g, '\\"');
    let supCmd = `claude --dangerously-skip-permissions --model opus --system-prompt "${systemPrompt}"`;
    if (resume && pairing?.supervisorSessionId) {
      supCmd += ` --resume ${pairing.supervisorSessionId}`;
    }

    // Launch supervisor
    execSync(
      `tmux new-session -d -s ${supTmux} -c ${JSON.stringify(cwd)} ${JSON.stringify(supCmd)}`,
      { timeout: 5000 },
    );

    // Write initial pairing immediately with what we know
    const startedAt = new Date().toISOString();
    {
      const pairingRec = pairing as unknown as Record<string, unknown> | null;
      const prevAgentSid = pairingRec?.agentSessionId as string | undefined;
      const prevSupSid = pairingRec?.supervisorSessionId as string | undefined;
      const initialAgentSid = resume && prevAgentSid ? prevAgentSid : sessionId;
      const initialSupSid = resume && prevSupSid ? prevSupSid : undefined;

      await writeSessionPairing(cwd, {
        agentTmux,
        agentSessionId: initialAgentSid,
        agentPid: undefined,  // filled in by background task
        supervisorTmux: supTmux,
        supervisorSessionId: initialSupSid,
        supervisorPid: undefined,
        startedAt,
      });
    }

    // Background task: wait for sessions to register, then fill in PIDs and sessionIds
    setTimeout(() => {
      void (async () => {
        try {
          const agentPanePid = execSync(
            `tmux list-panes -t ${agentTmux} -F "#{pane_pid}" 2>/dev/null`,
            { encoding: "utf-8" },
          ).trim();
          const supPanePid = execSync(
            `tmux list-panes -t ${supTmux} -F "#{pane_pid}" 2>/dev/null`,
            { encoding: "utf-8" },
          ).trim();

          let agentSid = sessionId;
          try {
            const raw = await readFile(join(SESSIONS_DIR, `${agentPanePid}.json`), "utf-8");
            const data = JSON.parse(raw) as Record<string, unknown>;
            if (!resume) agentSid = data.sessionId as string;
          } catch { /* empty */ }

          let supSid: string | undefined;
          try {
            const raw = await readFile(join(SESSIONS_DIR, `${supPanePid}.json`), "utf-8");
            supSid = (JSON.parse(raw) as Record<string, unknown>).sessionId as string;
          } catch { /* empty */ }

          const currentPairing = await readSessionPairing(cwd);
          const prevAgentSid = currentPairing?.agentSessionId;
          const prevSupSid = currentPairing?.supervisorSessionId;
          const finalAgentSid = resume && prevAgentSid ? prevAgentSid : agentSid;
          const finalSupSid = resume && prevSupSid ? prevSupSid : supSid;

          await writeSessionPairing(cwd, {
            agentTmux,
            agentPid: Number(agentPanePid) || undefined,
            agentSessionId: finalAgentSid,
            supervisorTmux: supTmux,
            supervisorPid: Number(supPanePid) || undefined,
            supervisorSessionId: finalSupSid,
            startedAt,
          });

          log.debug({ agentSid: finalAgentSid?.slice(0, 8), supSid: finalSupSid?.slice(0, 8) }, "pairing PIDs and sessionIds written");
        } catch (err) {
          log.debug({ err }, "failed to write pairing PIDs");
        }
      })();
    }, 8000);

    // Background task: poll for JSONL files to appear and update pairing
    const pollJsonl = (attempt: number): void => {
      if (attempt > 10) return;  // give up after ~60s
      setTimeout(() => {
        void (async () => {
          try {
            const currentPairing = await readSessionPairing(cwd);
            if (!currentPairing) return;
            let dirty = false;

            // Detect agent JSONL
            if (!currentPairing.agentJsonl) {
              const excludeIds = new Set<string>();
              if (currentPairing.supervisorSessionId) excludeIds.add(currentPairing.supervisorSessionId);
              const agentJsonl = await detectJsonlForRole(
                cwd,
                currentPairing.agentSessionId,
                startedAt,
                excludeIds,
              );
              if (agentJsonl) {
                currentPairing.agentJsonl = agentJsonl;
                dirty = true;
                log.debug({ agentJsonl: agentJsonl.split("/").pop() }, "detected agent JSONL");
              }
            }

            // Detect supervisor JSONL
            if (!currentPairing.supervisorJsonl && currentPairing.supervisorSessionId) {
              const supJsonl = await detectJsonlForRole(
                cwd,
                currentPairing.supervisorSessionId,
                startedAt,
                new Set<string>(),
              );
              if (supJsonl) {
                currentPairing.supervisorJsonl = supJsonl;
                dirty = true;
                log.debug({ supervisorJsonl: supJsonl.split("/").pop() }, "detected supervisor JSONL");
              }
            }

            if (dirty) {
              await writeSessionPairing(cwd, currentPairing);
            }

            // If still missing either, keep polling
            if (!currentPairing.agentJsonl || !currentPairing.supervisorJsonl) {
              pollJsonl(attempt + 1);
            }
          } catch {
            pollJsonl(attempt + 1);
          }
        })();
      }, 6000);  // poll every 6 seconds
    };
    pollJsonl(0);

    // Send initial context to supervisor once ready
    const contextMsg = `You are now supervising the "${dirName}" session (${cwd}).
The agent is running in tmux session: ${agentTmux}
Run: mkdir -p .ccboard && (grep -q '.ccboard/' .gitignore 2>/dev/null || echo '.ccboard/' >> .gitignore)
Then introduce yourself and tell me what you see in this project. Read the recent git log and any CLAUDE.md or README.`;

    let attempts = 0;
    const sendInitial = (): void => {
      attempts++;
      if (attempts > 20) return;
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

    // Register supervisor in the supervisors map (keyed by agent PID once known)
    setTimeout(() => {
      void (async () => {
        try {
          const agentPanePid = Number(
            execSync(
              `tmux list-panes -t ${agentTmux} -F "#{pane_pid}" 2>/dev/null`,
              { encoding: "utf-8" },
            ).trim(),
          );

          const pairingData = await readSessionPairing(cwd);
          // Prefer the explicit agentJsonl from pairing, then fall back
          let agentJsonlPath = pairingData?.agentJsonl ?? null;
          if (!agentJsonlPath) {
            const projectDir = cwdToProjectDir(cwd);
            const agentJsonlId = pairingData?.agentSessionId;
            agentJsonlPath = agentJsonlId
              ? join(PROJECTS_DIR, projectDir, `${agentJsonlId}.jsonl`)
              : await findLargestJsonl(projectDir, cwd);
          }

          supervisors.set(agentPanePid, {
            tmuxSession: supTmux,
            stopped: false,
            jsonlPath: agentJsonlPath,
            results: null,
          });
        } catch { /* empty */ }
      })();
    }, 10000);

    res.json({ ok: true, agentTmux, supTmux });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message.slice(0, 200) : "unknown error";
    res.status(500).json({ error: `failed to launch: ${msg}` });
  }
});

// GET /api/resumable — list recent sessions that can be resumed
router.get("/resumable", async (_req, res) => {
  try {
    const activeSessions = await getSessions();
    const activeProjectDirs = new Set(
      activeSessions.map((s) => cwdToProjectDir(s.cwd)),
    );

    const projects = await readdir(PROJECTS_DIR);

    interface ResumableItem {
      sessionId: string;
      cwd: string;
      shortName: string;
      slug: string | null;
      lastSnippet: string | null;
      lastModified: number;
    }

    const resumable: ResumableItem[] = [];

    for (const proj of projects) {
      const projPath = join(PROJECTS_DIR, proj);
      let files: string[];
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

          const sid = jsonl.replace(".jsonl", "");
          // Decode project dir back to path (lossy — dashes are ambiguous)
          const decodedCwd = proj.replace(/^-/, "/").replace(/-/g, "/");

          // Skip if there's an active session in this project
          if (activeProjectDirs.has(proj)) continue;

          // Get snippet from tail
          const lines = await tailFile(join(projPath, jsonl), 16384);
          let slug: string | null = null;
          let lastSnippet: string | null = null;
          for (let i = lines.length - 1; i >= 0; i--) {
            try {
              const entry = JSON.parse(lines[i] ?? "") as Record<string, unknown>;
              if (typeof entry.slug === "string" && !slug) slug = entry.slug;
              if (entry.type === "assistant" && !lastSnippet) {
                const message = entry.message as Record<string, unknown> | undefined;
                const content = message?.content;
                if (Array.isArray(content)) {
                  const textBlock = content.find(
                    (c): c is Record<string, unknown> =>
                      typeof c === "object" && c !== null && (c as Record<string, unknown>).type === "text",
                  ) as Record<string, unknown> | undefined;
                  if (textBlock && typeof textBlock.text === "string") {
                    lastSnippet = textBlock.text.split("\n")[0]?.slice(0, 100) ?? null;
                  }
                }
              }
              if (slug && lastSnippet) break;
            } catch {
              // skip
            }
          }

          resumable.push({
            sessionId: sid,
            cwd: decodedCwd,
            shortName: decodedCwd.split("/").pop() || proj,
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
    const seen = new Set<string>();
    const deduped = resumable.filter((r) => {
      if (seen.has(r.cwd)) return false;
      seen.add(r.cwd);
      return true;
    });
    res.json(deduped.slice(0, 20));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "unknown error";
    res.status(500).json({ error: msg });
  }
});

export default router;
