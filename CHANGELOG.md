# Changelog

## [0.3.0] - 2026-03-29

### Added
- **Launch sessions from ccboard** — "NEW SESSION" button opens a modal to launch Claude Code in a tmux session with a given working directory and optional name
- **Resume sessions from ccboard** — "RESUME SESSION" button shows recent inactive sessions (last 7 days), click to resume in a new tmux session via `claude --resume`
- **Send messages from browser** — type in the session detail page, delivered via `tmux send-keys` + `tmux paste-buffer` (universal, works with any terminal app)
- **tmux-based session management** — sessions launched through ccboard run inside tmux, enabling full input/output control from the browser
- **Managed session detection** — CCB badge on sessions launched through ccboard, with tmux pane content inspection for accurate status
- **Rescue command** — every managed session shows a clickable `tmux attach -t ...` command for direct terminal access if ccboard goes down
- **Resumable session filtering** — active sessions (both terminal and tmux) are excluded from the resume list
- **tmux pane-based status detection** — reads the tmux pane for the `❯` prompt to detect when Claude Code is waiting for input, fixing status for tmux sessions where JSONL hasn't caught up
- Created `~/.tmux.conf` with `set -g mouse on` so scroll works in tmux sessions

### Changed
- Context window max updated from 200K to 1M tokens (Claude Code's actual limit)
- Session detail actions/messages panels now use fixed-height scrollable containers that start at the bottom (like a terminal)
- Messages tab scrolls to bottom when switched to (was broken because tab was hidden on initial load)
- Send feature replaced: removed broken TTY write and osascript approaches, now uses tmux which works with any terminal app

### Fixed
- Messages scroll not starting at bottom when switching tabs (hidden panels have zero scrollHeight)
- Managed session status stuck on "idle" — tmux pane PID is the claude process itself, not a shell parent

## [0.2.0] - 2026-03-29

### Added
- **Session detail view** (`/session/{pid}`) — click any session on the dashboard to deep-dive
- **Action log** — shows every action Claude took since your last message: Bash commands (with description), file reads/writes/edits (with paths), Glob/Grep patterns, Agent spawns
- **Context window stats** — total tokens in context, % utilization bar, turn count, tool call count
- **Message chain** — full human/assistant conversation with timestamps, scrollable
- Three new API endpoints: `/api/sessions/:pid/actions`, `/api/sessions/:pid/messages`, `/api/sessions/:pid/context`
- Full JSONL conversation parser on the server (reads entire file for detail views)
- Session rows on dashboard are now clickable links

## [0.1.0] - 2026-03-29

### Added
- Initial project scaffolding: Express server + vanilla HTML/CSS/JS frontend
- Session detection from `~/.claude/sessions/*.json` cross-referenced with `ps`
- Status inference (waiting/working/idle) based on process CPU state + JSONL analysis
- JSONL conversation parsing: reads last 64KB of session transcripts to extract context
- Context snippets: shows last Claude response as a one-liner per session
- Session slugs displayed (e.g. "ticklish-cooking-crab")
- Last activity timestamps from JSONL (not just process start time)
- Stale session escalation: sessions waiting >5m/10m/15m get increasingly urgent visual treatment (amber → red border + red background)
- Browser notifications when a session transitions from working → waiting for input
- Page title shows attention count: `(3) ccboard`
- Hacker aesthetic UI: CRT scanlines, vignette, screen flicker, monospace font (Share Tech Mono), amber/cyan/green status colors
- Auto-polling every 3 seconds
- Sessions sorted by priority: waiting → working → idle, then by recency
- TTY label per session
- Paperclip reference codebase moved to `paperclip-ref/` for study
- Phase documentation in PHASES.md
