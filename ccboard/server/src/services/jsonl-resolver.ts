import { readdir, readFile, stat, open } from "fs/promises";
import { execSync } from "child_process";
import { join } from "path";
import { SESSIONS_DIR, PROJECTS_DIR } from "../lib/constants.js";
import { getManagedTmuxSessions } from "./tmux.js";
import { cwdToProjectDir, readSessionPairing } from "./pairing.js";

/** Collect session IDs belonging to supervisor tmux sessions */
export async function getSupervisorSessionIds(): Promise<Set<string>> {
  const ids = new Set<string>();
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
  return ids;
}

/** Supervisor-marker strings found in the first bytes of supervisor JONLs */
const SUPERVISOR_MARKERS = [
  "supervising",
  "SUPERVISOR",
  "council",
  "pair-programming supervisor",
] as const;

/**
 * Find the most recently modified JSONL in a project directory.
 * Excludes JONLs belonging to supervisor sessions.
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

  // Collect ALL supervisor session IDs to exclude:
  // 1. From running tmux sessions
  const supIds = await getSupervisorSessionIds();

  // 2. From the pairing file (catches old/stopped supervisors)
  if (cwd) {
    try {
      const pairing = await readSessionPairing(cwd);
      if (pairing?.supervisorSessionId) supIds.add(pairing.supervisorSessionId);
    } catch {
      // ignore
    }
  }

  // 3. Heuristic: check first 2 KB of each JSONL for supervisor markers
  for (const f of jsonls) {
    const sid = f.replace(".jsonl", "");
    if (supIds.has(sid)) continue;
    try {
      const fh = await open(join(dirPath, f), "r");
      const buf = Buffer.alloc(2000);
      await fh.read(buf, 0, 2000, 0);
      await fh.close();
      const head = buf.toString("utf-8");
      if (SUPERVISOR_MARKERS.some((m) => head.includes(m))) {
        supIds.add(sid);
      }
    } catch {
      // skip
    }
  }

  let latest: string | null = null;
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
    } catch {
      // skip
    }
  }
  return latest ? join(dirPath, latest) : null;
}

/**
 * Find the largest (by bytes) non-supervisor JSONL in a project directory.
 * Typically the main agent conversation.
 */
export async function findLargestJsonl(
  projectDir: string,
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

  const supIds = await getSupervisorSessionIds();

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
 * Tries: (1) exact sessionId, (2) most-recent non-supervisor file.
 */
export async function resolveActiveJsonl(
  _pid: number,
  cwd: string,
  sessionId: string,
): Promise<string | null> {
  const projectDir = cwdToProjectDir(cwd);

  // 1. Try exact sessionId match
  const exactPath = join(PROJECTS_DIR, projectDir, `${sessionId}.jsonl`);
  try {
    await stat(exactPath);
    return exactPath;
  } catch {
    // fall through
  }

  // 2. Pick the most recently modified JSONL, excluding the current supervisor
  const dirPath = join(PROJECTS_DIR, projectDir);
  let files: string[];
  try {
    files = await readdir(dirPath);
  } catch {
    return null;
  }
  const jsonls = files.filter((f) => f.endsWith(".jsonl"));

  const excludeIds = new Set<string>();
  try {
    const pairing = await readSessionPairing(cwd);
    if (pairing?.supervisorSessionId) excludeIds.add(pairing.supervisorSessionId);
  } catch {
    // ignore
  }

  let latest: string | null = null;
  let latestMtime = 0;
  for (const f of jsonls) {
    const sid = f.replace(".jsonl", "");
    if (excludeIds.has(sid)) continue;
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
  const supIds = await getSupervisorSessionIds();
  const paths = new Set<string>();

  // Active JSONL
  const active = await resolveActiveJsonl(pid, cwd, sessionId);
  if (active) paths.add(active);

  // Pairing file JSONL (may be a different, older session)
  try {
    const pairing = await readSessionPairing(cwd);
    if (pairing?.agentTmux) {
      // agentSessionId may be stored under a different key; check for agentSessionId-like field
      // In the JS original, it uses pairing.agentSessionId — we access the parsed JSON carefully
      const pairingAny = pairing as unknown as Record<string, unknown>;
      const agentSessionId = pairingAny.agentSessionId;
      if (typeof agentSessionId === "string") {
        const pairingPath = join(PROJECTS_DIR, projectDir, `${agentSessionId}.jsonl`);
        try {
          await stat(pairingPath);
          if (!supIds.has(agentSessionId)) paths.add(pairingPath);
        } catch {
          // file doesn't exist
        }
      }
    }
  } catch {
    // ignore
  }

  // Also include the largest non-supervisor JSONL (the main conversation)
  const largest = await findLargestJsonl(projectDir);
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
    return findLatestJsonl(projectDir);
  }
}
