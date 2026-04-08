import { execSync } from "child_process";
import type { ClaudeProcess } from "../schemas/session.js";

/** Scan running processes for Claude Code instances.
 *  Filters out Claude Helper, Claude.app, crashpad, ShipIt. */
export function getClaudeProcesses(): Map<number, ClaudeProcess> {
  try {
    const output = execSync(
      `ps -eo pid,stat,%cpu,tty,command | grep -E '\\bclaude\\b' | grep -v grep`,
      { encoding: "utf-8" }
    );
    const processes = new Map<number, ClaudeProcess>();
    for (const line of output.trim().split("\n")) {
      if (!line.trim()) continue;
      const match = line.trim().match(/^(\d+)\s+(\S+)\s+([\d.]+)\s+(\S+)\s+(.+)$/);
      if (!match) continue;
      const [, pidStr, statStr, cpuStr, ttyStr, cmdStr] = match as RegExpMatchArray;
      if (!pidStr || !statStr || !cpuStr || !ttyStr || !cmdStr) continue;
      if (
        cmdStr.includes("Claude Helper") ||
        cmdStr.includes("Claude.app") ||
        cmdStr.includes("crashpad") ||
        cmdStr.includes("ShipIt")
      )
        continue;
      processes.set(Number(pidStr), {
        pid: Number(pidStr),
        stat: statStr,
        cpu: parseFloat(cpuStr),
        tty: ttyStr,
      });
    }
    return processes;
  } catch {
    return new Map();
  }
}
