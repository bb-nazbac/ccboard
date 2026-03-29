# ccboard — Phases

## Phase 1: Awareness Dashboard (complete)

A read-only web dashboard that shows all active Claude Code sessions at a glance. Runs in the browser alongside your terminal.

### Goals
- Eliminate forgotten/neglected sessions
- Reduce context-switching cost when returning to a session
- Surface which sessions need your attention right now

### Features
| Feature | Status | Description |
|---|---|---|
| Session detection | done | Reads `~/.claude/sessions/*.json`, cross-references with running processes |
| Status inference | done | CPU state + JSONL turn_duration detection for accurate waiting/working/idle |
| Hacker UI | done | CRT scanlines, vignette, flicker, Share Tech Mono, amber/cyan/green palette |
| Last activity time | done | Reads session JSONL timestamps, shows "Xm ago" relative time |
| Context snippet | done | Last Claude response shown as one-liner per session |
| Needs-attention alert | done | Browser notification on working → waiting transition + amber flash |
| Stale session warning | done | Escalating urgency: >5m amber, >10m red border, >15m red background |
| Better status detection | done | JSONL turn_duration + CPU heuristic combined |
| Terminal ID label | done | TTY shown per session (e.g. ttys003) |
| Session slugs | done | Shows Claude's session name (e.g. "ticklish-cooking-crab") |
| Page title badge | done | Tab shows `(N) ccboard` when N sessions need attention |

### Explicitly NOT in Phase 1
- No session launching or control
- No transcript viewer
- No click-to-focus terminal switching
- No session naming/tagging

---

## Phase 2: Session Deep Dive + Control (complete)

Click any session on the dashboard to see its full detail view. Launch, resume, and send messages to sessions from the browser.

### Goals
- Instantly understand what Claude did since your last message
- Know how full the context window is before you message
- Read the conversation and reply without switching terminals
- Launch and resume sessions without leaving the browser

### Features
| Feature | Status | Description |
|---|---|---|
| Action log | done | Every action since your last message: Bash commands, file reads/writes/edits, Glob/Grep, Agent spawns |
| Context window stats | done | Total tokens (1M max), % used, turns count, tool call count — with visual bar |
| Message chain | done | Full human/assistant conversation history with timestamps, scrolls to bottom |
| Launch session | done | "NEW SESSION" button → enters cwd + name → launches Claude Code in a tmux session |
| Resume session | done | "RESUME SESSION" → shows recent inactive sessions → click to resume via `claude --resume` |
| Send message | done | Type in browser → delivered via `tmux send-keys` (works with any terminal app) |
| Rescue command | done | Every managed session shows a clickable `tmux attach -t ...` for direct terminal access |
| Managed detection | done | CCB badge + tmux pane inspection for accurate status on tmux sessions |
| Active session filtering | done | Resume list excludes all currently active sessions (terminal or tmux) |

### Architecture decisions
- **tmux as universal transport** — sessions launched through ccboard run in tmux. This enables `send-keys` for input delivery, which works regardless of terminal app (Warp, Ghostty, Terminal.app, iTerm2, etc.)
- **Pane-based status detection** — for tmux sessions, reads the pane content for Claude Code's `❯` prompt to detect "waiting for input" — more reliable than JSONL which may not have caught up
- **Action log** parses JSONL entries from the last human-typed message forward, extracting tool_use blocks with their inputs
- **Context stats** reads token usage from the most recent assistant message — `input_tokens + cache_read + cache_creation` gives total context size
- **Message chain** filters JSONL to human-typed messages (have `promptId`, no `sourceToolAssistantUUID`) and assistant text responses
- **Two classes of sessions**: managed (launched via ccboard, full control) and unmanaged (launched in terminal tabs, read-only monitoring)

### Key learnings
- There is no universal way to inject input into another process's terminal — each terminal app has its own API, and macOS disabled TIOCSTI. tmux is the only terminal-agnostic transport layer.
- Claude Code's pane PID in tmux IS the claude process (no shell wrapper), so PID matching must check the pane PID directly, not just children.
- tmux `set -g mouse on` is required for scroll to pass through to Claude Code's alternate screen.

---

## Phase 3 (planned)
TBD — likely: activity feed across sessions, cost tracking, session naming/tagging.
