import { execSync } from "child_process";

/** Run a shell command, return trimmed stdout. Returns null on failure. */
export function exec(cmd: string): string | null {
  try {
    return execSync(cmd, { encoding: "utf-8", timeout: 5000 }).trim();
  } catch {
    return null;
  }
}

/** Run a shell command, throw on failure. */
export function execOrThrow(cmd: string): string {
  return execSync(cmd, { encoding: "utf-8", timeout: 10000 }).trim();
}
