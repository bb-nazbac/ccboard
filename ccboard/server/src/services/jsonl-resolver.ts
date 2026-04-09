import { readdir, readFile, stat } from "fs/promises";
import { execSync } from "child_process";
import { join } from "path";
import { SESSIONS_DIR, PROJECTS_DIR } from "../lib/constants.js";
import { getManagedTmuxSessions } from "./tmux.js";
import {
  cwdToProjectDir,
  readSessionPairing,
  backfillPairing,
  updateSessionPairing,
  detectJsonlForRole,
} from "./pairing.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("jsonl");

/**
 * Collect session IDs belonging to supervisor tmux sessions.
 * Reads from both running tmux sessions AND pairing files.
 */
export async function getSupervisorSessionIds(cwd?: string): Promise<Set<string>> {
  const ids = new Set<string>();

  // 1. From running tmux sessions (live)
  const managed = getManagedTmuxSessions();
  for (const name of managed) {
    if (!name.includes("-sup-")) continue;
    try {
      const panePid = execSync(
        `tmux list-panes -t ${name} -F "#{pane_pid}" 2>/dev/null`,
        { encoding: "utf-8" }
      ).trim();
      const raw = await readFile(join(SESSIONS_DIR, `${panePid}.json`), "utf-8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const sessionId = parsed.sessionId;
      if (typeof sessionId === "string") ids.add(sessionId);
    } catch {
      // skip — pane or file might not exist
    }
  }

  // 2. From pairing file (catches old/stopped supervisors)
  if (cwd) {
    try {
      const pairing = await readSessionPairing(cwd);
      if (pairing?.supervisorSessionId) ids.add(pairing.supervisorSessionId);
    } catch {
      // ignore
    }
  }

  return ids;
}

/**
 * Find the most recently modified JSONL in a project directory.
 * Excludes JONLs belonging to supervisor sessions using pairing-based exclusion only
 * (NO content heuristics).
 */
export async function findLatestJsonl(
  projectDir: string,
  cwd?: string,
): Promise<string | null> {
  const dirPath = join(PROJECTS_DIR, projectDir);
  let files: string[];
  try {
    files = await readdir(dirPath);
  } catch {
    return null;
  }
  const jsonls = files.filter((f) => f.endsWith(".jsonl"));
  if (jsonls.length === 0) return null;

  // Collect supervisor session IDs to exclude (pairing + tmux, no content heuristic)
  const supIds = await getSupervisorSessionIds(cwd);

  log.debug({ supIds: [...supIds], jsonlCount: jsonls.length, projectDir }, "excluding supervisor JONLs");

  let latest: string | null = null;
  let latestMtime = 0;
  for (const f of jsonls) {
    const sessionId = f.replace(".jsonl", "");
    if (supIds.has(sessionId)) {
      log.debug({ sessionId: sessionId.slice(0, 8) }, "excluded supervisor JSONL");
      continue;
    }
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
  const result = latest ? join(dirPath, latest) : null;
  log.debug({ result: result?.split("/").pop() }, "findLatestJsonl resolved");
  return result;
}

/**
 * Find the largest (by bytes) non-supervisor JSONL in a project directory.
 * Typically the main agent conversation.
 */
export async function findLargestJsonl(
  projectDir: string,
  cwd?: string,
): Promise<string | null> {
  const dirPath = join(PROJECTS_DIR, projectDir);
  let files: string[];
  try {
    files = await readdir(dirPath);
  } catch {
    return null;
  }
  const jsonls = files.filter((f) => f.endsWith(".jsonl"));
  if (jsonls.length === 0) return null;

  const supIds = await getSupervisorSessionIds(cwd);

  let largest: string | null = null;
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
    } catch {
      // skip
    }
  }
  return largest ? join(dirPath, largest) : null;
}

/**
 * Resolve the ACTIVE JSONL (what the agent is writing to right now).
 * Priority:
 *   1. Pairing file: if agentJsonl is set and file exists → use it
 *   2. Exact sessionId match: if {sessionId}.jsonl exists → use it, update pairing
 *   3. Process-time fallback: most recently modified JSONL after startedAt, excluding supervisor
 *   4. Legacy fallback: findLatestJsonl (for non-managed sessions)
 */
export async function resolveActiveJsonl(
  _pid: number,
  cwd: string,
  sessionId: string,
): Promise<string | null> {
  const projectDir = cwdToProjectDir(cwd);

  // 1. Check pairing file for explicit agentJsonl
  try {
    const pairing = await readSessionPairing(cwd);
    if (pairing?.agentJsonl) {
      try {
        await stat(pairing.agentJsonl);
        log.debug({ pid: _pid, method: "pairing-agentJsonl", file: pairing.agentJsonl.split("/").pop() }, "resolveActiveJsonl");
        return pairing.agentJsonl;
      } catch {
        log.debug({ pid: _pid }, "pairing agentJsonl file missing, falling through");
      }
    }
  } catch {
    // no pairing file
  }

  // 2. Exact sessionId match
  const exactPath = join(PROJECTS_DIR, projectDir, `${sessionId}.jsonl`);
  try {
    await stat(exactPath);
    log.debug({ pid: _pid, sessionId: sessionId.slice(0, 8), method: "exact" }, "resolveActiveJsonl");
    // Update pairing with discovered path
    void updateSessionPairing(cwd, { agentJsonl: exactPath, agentSessionId: sessionId });
    return exactPath;
  } catch {
    log.debug({ pid: _pid, sessionId: sessionId.slice(0, 8) }, "exact JSONL not found");
  }

  // 3. Process-time fallback using pairing metadata
  try {
    const pairing = await readSessionPairing(cwd);
    if (pairing) {
      const excludeIds = new Set<string>();
      if (pairing.supervisorSessionId) excludeIds.add(pairing.supervisorSessionId);

      const detected = await detectJsonlForRole(
        cwd,
        pairing.agentSessionId,
        pairing.startedAt,
        excludeIds,
      );
      if (detected) {
        log.debug({ pid: _pid, method: "time-fallback", file: detected.split("/").pop() }, "resolveActiveJsonl");
        void updateSessionPairing(cwd, { agentJsonl: detected });
        return detected;
      }
    }
  } catch {
    // ignore
  }

  // 4. Trigger a backfill attempt, then try again from pairing
  try {
    const backfilled = await backfillPairing(cwd);
    if (backfilled?.agentJsonl) {
      try {
        await stat(backfilled.agentJsonl);
        log.debug({ pid: _pid, method: "backfill", file: backfilled.agentJsonl.split("/").pop() }, "resolveActiveJsonl");
        return backfilled.agentJsonl;
      } catch {
        // file gone
      }
    }
  } catch {
    // ignore
  }

  // 5. Legacy fallback for non-managed sessions
  log.debug({ pid: _pid, method: "legacy-fallback" }, "resolveActiveJsonl");
  return findLatestJsonl(projectDir, cwd);
}

/**
 * Resolve ALL relevant JONLs for full history (active + pairing + largest).
 * Returns de-duplicated absolute paths.
 */
export async function resolveHistoryJsonls(
  pid: number,
  cwd: string,
  sessionId: string,
): Promise<string[]> {
  const projectDir = cwdToProjectDir(cwd);
  const supIds = await getSupervisorSessionIds(cwd);
  const paths = new Set<string>();

  // Active JSONL
  const active = await resolveActiveJsonl(pid, cwd, sessionId);
  if (active) paths.add(active);

  // Pairing file JSONL (may be a different, older session)
  try {
    const pairing = await readSessionPairing(cwd);
    if (pairing?.agentSessionId) {
      const pairingPath = join(PROJECTS_DIR, projectDir, `${pairing.agentSessionId}.jsonl`);
      try {
        await stat(pairingPath);
        if (!supIds.has(pairing.agentSessionId)) paths.add(pairingPath);
      } catch {
        // file doesn't exist
      }
    }
  } catch {
    // ignore
  }

  // Also include the largest non-supervisor JSONL (the main conversation)
  const largest = await findLargestJsonl(projectDir, cwd);
  if (largest) paths.add(largest);

  return [...paths];
}

/** Backwards-compat alias: resolve the active JSONL for a PID */
export async function resolveJsonlForPid(
  pid: number,
  cwd: string,
  sessionId: string,
): Promise<string | null> {
  return resolveActiveJsonl(pid, cwd, sessionId);
}

/** Resolve the JSONL path for a cwd + sessionId (exact match or latest fallback) */
export async function resolveJsonlPath(
  cwd: string,
  sessionId: string,
): Promise<string | null> {
  const projectDir = cwdToProjectDir(cwd);
  const jsonlPath = join(PROJECTS_DIR, projectDir, `${sessionId}.jsonl`);
  try {
    await stat(jsonlPath);
    return jsonlPath;
  } catch {
    return findLatestJsonl(projectDir, cwd);
  }
}
