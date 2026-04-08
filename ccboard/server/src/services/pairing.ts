import { readFile, writeFile } from "fs/promises";
import { join } from "path";

/** Encode a cwd path to the project directory name Claude uses.
 *  /Users/bahaa/Documents/foo_bar baz → -Users-bahaa-Documents-foo-bar-baz */
export function cwdToProjectDir(cwd: string): string {
  return cwd.replace(/[\/ _]/g, "-");
}

export interface SessionPairing {
  agentTmux: string;
  supervisorTmux: string;
  supervisorSessionId?: string;
  agentPid?: number;
  supervisorPid?: number;
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
  await writeFile(join(dir, "session.json"), JSON.stringify(pairing, null, 2));
}
