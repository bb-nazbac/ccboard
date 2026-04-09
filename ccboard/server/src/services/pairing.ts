import { readdir, readFile, stat, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { execSync } from "child_process";
import { SESSIONS_DIR, PROJECTS_DIR } from "../lib/constants.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("pairing");

/** Encode a cwd path to the project directory name Claude uses.
 *  /Users/bahaa/Documents/foo_bar baz → -Users-bahaa-Documents-foo-bar-baz */
export function cwdToProjectDir(cwd: string): string {
  return cwd.replace(/[\/ _]/g, "-");
}

export interface SessionPairing {
  agentTmux: string;
  agentPid?: number;
  agentJsonl?: string;           // absolute path to agent's JSONL
  agentSessionId?: string;       // Claude's sessionId for the agent
  supervisorTmux: string;
  supervisorPid?: number;
  supervisorJsonl?: string;      // absolute path to supervisor's JSONL
  supervisorSessionId?: string;
  startedAt?: string;
}

/** Read the .ccboard/session.json pairing file for a project */
export async function readSessionPairing(cwd: string): Promise<SessionPairing | null> {
  try {
    const raw = await readFile(join(cwd, ".ccboard", "session.json"), "utf-8");
    return JSON.parse(raw) as SessionPairing;
  } catch {
    return null;
  }
}

/** Write the .ccboard/session.json pairing file */
export async function writeSessionPairing(cwd: string, pairing: SessionPairing): Promise<void> {
  const dir = join(cwd, ".ccboard");
  try {
    await mkdir(dir, { recursive: true });
  } catch {
    // already exists
  }
  await writeFile(join(dir, "session.json"), JSON.stringify(pairing, null, 2));
}

/** Update specific fields in the pairing file without overwriting the rest */
export async function updateSessionPairing(cwd: string, updates: Partial<SessionPairing>): Promise<SessionPairing | null> {
  const existing = await readSessionPairing(cwd);
  if (!existing) return null;
  const merged: SessionPairing = { ...existing, ...updates };
  await writeSessionPairing(cwd, merged);
  log.debug({ cwd: cwd.split("/").pop(), updates: Object.keys(updates) }, "pairing updated");
  return merged;
}

/**
 * Detect the agent's JSONL file for a given project.
 * 1. Check if {sessionId}.jsonl exists
 * 2. Otherwise find the most recently modified JSONL after startedAt, excluding supervisor JONLs
 */
export async function detectJsonlForRole(
  cwd: string,
  sessionId: string | undefined,
  startedAt: string | undefined,
  excludeSessionIds: Set<string>,
): Promise<string | null> {
  const projectDir = cwdToProjectDir(cwd);
  const dirPath = join(PROJECTS_DIR, projectDir);

  // 1. Exact sessionId match
  if (sessionId) {
    const exactPath = join(dirPath, `${sessionId}.jsonl`);
    try {
      await stat(exactPath);
      log.debug({ sessionId: sessionId.slice(0, 8), method: "exact" }, "detectJsonlForRole");
      return exactPath;
    } catch {
      // fall through
    }
  }

  // 2. Find most recently modified JSONL after startedAt, excluding known IDs
  let files: string[];
  try {
    files = await readdir(dirPath);
  } catch {
    return null;
  }
  const jsonls = files.filter((f) => f.endsWith(".jsonl"));
  if (jsonls.length === 0) return null;

  const startedAtMs = startedAt ? new Date(startedAt).getTime() : 0;
  let latest: string | null = null;
  let latestMtime = 0;

  for (const f of jsonls) {
    const sid = f.replace(".jsonl", "");
    if (excludeSessionIds.has(sid)) continue;
    try {
      const info = await stat(join(dirPath, f));
      // If we have a startedAt, only consider files modified after that time
      if (startedAtMs > 0 && info.mtimeMs < startedAtMs) continue;
      if (info.mtimeMs > latestMtime) {
        latestMtime = info.mtimeMs;
        latest = f;
      }
    } catch {
      // skip
    }
  }

  if (latest) {
    const result = join(dirPath, latest);
    log.debug({ file: latest, method: "time-fallback" }, "detectJsonlForRole");
    return result;
  }

  return null;
}

/**
 * Backfill missing JSONL paths and session IDs in a pairing file.
 * Called on startup, on reviews endpoint, and as a fallback in resolveActiveJsonl.
 */
export async function backfillPairing(cwd: string): Promise<SessionPairing | null> {
  const pairing = await readSessionPairing(cwd);
  if (!pairing) return null;

  let dirty = false;
  const excludeIds = new Set<string>();

  // Collect known supervisor session IDs for exclusion
  if (pairing.supervisorSessionId) excludeIds.add(pairing.supervisorSessionId);

  // Try to fill in agentSessionId from tmux pane PID if missing
  if (!pairing.agentSessionId && pairing.agentTmux) {
    try {
      const panePid = execSync(
        `tmux list-panes -t ${pairing.agentTmux} -F "#{pane_pid}" 2>/dev/null`,
        { encoding: "utf-8" },
      ).trim();
      const raw = await readFile(join(SESSIONS_DIR, `${panePid}.json`), "utf-8");
      const data = JSON.parse(raw) as Record<string, unknown>;
      if (typeof data.sessionId === "string") {
        pairing.agentSessionId = data.sessionId;
        dirty = true;
        log.debug({ agentSessionId: pairing.agentSessionId.slice(0, 8) }, "backfill: found agentSessionId");
      }
    } catch {
      // tmux session may not exist
    }
  }

  // Try to fill in supervisorSessionId from tmux pane PID if missing
  if (!pairing.supervisorSessionId && pairing.supervisorTmux) {
    try {
      const panePid = execSync(
        `tmux list-panes -t ${pairing.supervisorTmux} -F "#{pane_pid}" 2>/dev/null`,
        { encoding: "utf-8" },
      ).trim();
      const raw = await readFile(join(SESSIONS_DIR, `${panePid}.json`), "utf-8");
      const data = JSON.parse(raw) as Record<string, unknown>;
      if (typeof data.sessionId === "string") {
        pairing.supervisorSessionId = data.sessionId;
        excludeIds.add(pairing.supervisorSessionId);
        dirty = true;
        log.debug({ supervisorSessionId: pairing.supervisorSessionId.slice(0, 8) }, "backfill: found supervisorSessionId");
      }
    } catch {
      // tmux session may not exist
    }
  }

  // Backfill agentJsonl
  if (!pairing.agentJsonl) {
    const detected = await detectJsonlForRole(
      cwd,
      pairing.agentSessionId,
      pairing.startedAt,
      excludeIds,
    );
    if (detected) {
      pairing.agentJsonl = detected;
      dirty = true;
      log.debug({ agentJsonl: detected.split("/").pop() }, "backfill: found agentJsonl");
    }
  } else {
    // Verify existing path still exists
    try {
      await stat(pairing.agentJsonl);
    } catch {
      // File no longer exists, try to re-detect
      const detected = await detectJsonlForRole(
        cwd,
        pairing.agentSessionId,
        pairing.startedAt,
        excludeIds,
      );
      if (detected) {
        pairing.agentJsonl = detected;
        dirty = true;
      }
    }
  }

  // Backfill supervisorJsonl
  if (!pairing.supervisorJsonl && pairing.supervisorSessionId) {
    const detected = await detectJsonlForRole(
      cwd,
      pairing.supervisorSessionId,
      pairing.startedAt,
      new Set<string>(),  // no exclusions when looking for supervisor
    );
    if (detected) {
      pairing.supervisorJsonl = detected;
      dirty = true;
      log.debug({ supervisorJsonl: detected.split("/").pop() }, "backfill: found supervisorJsonl");
    }
  }

  if (dirty) {
    await writeSessionPairing(cwd, pairing);
  }

  return pairing;
}

/**
 * Backfill pairings for all known project directories that have .ccboard/session.json.
 * Called on server startup.
 */
export async function backfillAllPairings(): Promise<void> {
  log.info("backfilling pairings for all known projects");
  try {
    const projects = await readdir(PROJECTS_DIR);
    for (const proj of projects) {
      // Decode project dir back to approximate cwd
      const decodedCwd = proj.replace(/^-/, "/").replace(/-/g, "/");
      try {
        // Check if this project has a pairing file
        await stat(join(decodedCwd, ".ccboard", "session.json"));
        await backfillPairing(decodedCwd);
      } catch {
        // No pairing file or decoding failed — skip
      }
    }
  } catch {
    log.debug("no projects dir to backfill");
  }
}
