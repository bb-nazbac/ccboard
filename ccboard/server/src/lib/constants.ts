import { join } from "path";
import { homedir } from "os";

export const PORT = 3200;
export const CLAUDE_DIR = join(homedir(), ".claude");
export const SESSIONS_DIR = join(CLAUDE_DIR, "sessions");
export const PROJECTS_DIR = join(CLAUDE_DIR, "projects");
export const TMUX_PREFIX = "ccboard";
export const MAX_CONTEXT = 1_000_000;
