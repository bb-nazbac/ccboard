import { execSync } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { TMUX_PREFIX } from "../lib/constants.js";

/** List all ccboard-managed tmux session names */
export function getManagedTmuxSessions(): string[] {
  try {
    const output = execSync(
      `tmux list-sessions -F "#{session_name}:#{session_created}" 2>/dev/null`,
      { encoding: "utf-8" }
    );
    const sessions: string[] = [];
    for (const line of output.trim().split("\n")) {
      if (!line.startsWith(TMUX_PREFIX + "-")) continue;
      const name = line.split(":")[0];
      if (name) sessions.push(name);
    }
    return sessions;
  } catch {
    return [];
  }
}

/** Find the ccboard tmux session name for a given PID */
export function findTmuxSessionForPid(pid: number): string | null {
  try {
    const output = execSync(
      `tmux list-panes -a -F "#{session_name}:#{pane_pid}" 2>/dev/null`,
      { encoding: "utf-8" }
    );
    for (const line of output.trim().split("\n")) {
      const parts = line.split(":");
      const sessionName = parts[0];
      const panePid = parts[1];
      if (!sessionName?.startsWith(TMUX_PREFIX + "-")) continue;
      if (Number(panePid) === pid) return sessionName;
      try {
        const children = execSync(
          `pgrep -P ${panePid} 2>/dev/null || echo ""`,
          { encoding: "utf-8" }
        ).trim();
        if (children.split("\n").map((p) => Number(p.trim())).includes(pid))
          return sessionName;
      } catch {
        // skip
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Check if a tmux pane is showing Claude Code's input prompt (❯) */
export function isTmuxPaneWaiting(tmuxSession: string | null): boolean {
  if (!tmuxSession) return false;
  try {
    const pane = execSync(
      `tmux capture-pane -t ${tmuxSession} -p 2>/dev/null`,
      { encoding: "utf-8" }
    );
    const lines = pane.split("\n").filter((l) => l.trim());
    const lastFew = lines.slice(-5).join("\n");
    return lastFew.includes("❯");
  } catch {
    return false;
  }
}

/** Send text to a tmux session via load-buffer + paste-buffer + Enter.
 *  Safer than send-keys for multi-line or special-character messages. */
export function sendToTmuxSession(tmuxSession: string, message: string): void {
  const tmpFile = `/tmp/ccboard-msg-${Date.now()}.txt`;
  writeFileSync(tmpFile, message);
  try {
    execSync(`tmux load-buffer ${tmpFile}`);
    execSync(`tmux paste-buffer -t ${tmuxSession}`);
    execSync(`tmux send-keys -t ${tmuxSession} Enter`);
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

/** Capture the current tmux pane content */
export function captureTmuxPane(tmuxSession: string): string | null {
  try {
    return execSync(
      `tmux capture-pane -t ${tmuxSession} -p -S -200 2>/dev/null`,
      { encoding: "utf-8" }
    );
  } catch {
    return null;
  }
}
