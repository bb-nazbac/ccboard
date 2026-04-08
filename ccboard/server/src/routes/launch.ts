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
import { cwdToProjectDir, readSessionPairing, writeSessionPairing } from "../services/pairing.js";
import {
  TMUX_PREFIX,
  SESSIONS_DIR,
  PROJECTS_DIR,
} from "../lib/constants.js";

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

/** Build the --system-prompt for the supervisor session */
function buildSupervisorSystemPrompt(primaryTmuxSession: string): string {
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
    const systemPrompt = buildSupervisorSystemPrompt(agentTmux).replace(/"/g, '\\"');
    let supCmd = `claude --dangerously-skip-permissions --model opus --system-prompt "${systemPrompt}"`;
    if (resume && pairing?.supervisorSessionId) {
      supCmd += ` --resume ${pairing.supervisorSessionId}`;
    }

    // Launch supervisor
    execSync(
      `tmux new-session -d -s ${supTmux} -c ${JSON.stringify(cwd)} ${JSON.stringify(supCmd)}`,
      { timeout: 5000 },
    );

    // Wait for both to register, then save pairing
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

          let supSid: string | null = null;
          try {
            const raw = await readFile(join(SESSIONS_DIR, `${supPanePid}.json`), "utf-8");
            supSid = (JSON.parse(raw) as Record<string, unknown>).sessionId as string;
          } catch { /* empty */ }

          const pairingRec = pairing as unknown as Record<string, unknown> | null;
          const prevAgentSid = pairingRec?.agentSessionId as string | undefined;
          const prevSupSid = pairingRec?.supervisorSessionId as string | undefined;
          const finalAgentSid = resume && prevAgentSid ? prevAgentSid : agentSid;
          const finalSupSid = resume && prevSupSid ? prevSupSid : supSid;

          if (finalAgentSid || finalSupSid) {
            await writeSessionPairing(cwd, {
              agentTmux,
              supervisorTmux: supTmux,
              supervisorSessionId: finalSupSid ?? undefined,
              startedAt: new Date().toISOString(),
            });
          }
        } catch { /* empty */ }
      })();
    }, 8000);

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
          const pairingRec = pairingData as unknown as Record<string, unknown> | null;
          const agentJsonlId = pairingRec?.agentSessionId as string | undefined;
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
