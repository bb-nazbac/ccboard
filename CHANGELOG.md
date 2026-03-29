# Changelog

## [0.4.0] - 2026-03-29

### Added
- **Interactive supervisor** — the supervisor is now a Claude Code session you chat with, not an automated review loop. It acts as a pair programmer and tech lead.
- **Three-pane session layout** — left: supervisor chat, center top: actions, center bottom: reviews, right: agent chat. All panes scroll independently.
- **Supervisor chat interface** — full message input/output in the browser, reads from supervisor's JSONL, sends via tmux
- **Supervisor → agent messaging** — supervisor can send messages to the primary Claude Code agent via tmux send-keys. Enabled when the agent is a ccboard-managed session.
- **Read-only supervisor** — system prompt restricts supervisor to Read/Grep/Glob/Bash(read-only). Can only write to `.ccboard/` folder.
- **`.ccboard/` persistent output** — supervisor and its subagents write structured reviews to `.ccboard/{category}.json` and `.ccboard/review.json`. Persists across supervisor restarts.
- **Review detail modals** — click any review row to see: summary, methodology (criteria, baseline, files checked), findings with severity/location/description/suggestion/evidence
- **Reviews panel** — bottom half of center pane shows latest review outputs from `.ccboard/`, polls every 15s
- **Supervisor endpoints** — `/api/sessions/:pid/supervisor/messages`, `/api/sessions/:pid/supervisor/send`, `/api/sessions/:pid/supervisor/reviews`
- **JSONL path caching** — `resolveJsonlForPid()` caches resolved paths per PID, preventing cross-contamination when supervisor/subagents create JONLs in the same project directory
- **Supervisor noise filtering** — `isSupervisorNoise()` function filters supervisor-related messages from primary session's actions, messages, and activity payloads
- **Collapsible action turns** — actions tab shows ALL turns grouped by human message, each collapsible, last expanded by default
- **Subagent category identification** — each agent brief includes a `category` field the agent must echo back, plus agents write to named files (`.ccboard/codeQuality.json` etc.)
- **Rich subagent methodology** — agents report: files they checked, criteria applied, baseline compared against, evidence for each finding

### Changed
- Session detail page completely rewritten: tabs replaced with three-pane layout
- Supervisor architecture: from automated `setInterval`/`setTimeout` tick loop → interactive chat session
- Supervisor system prompt: from "output JSON only" → full pair programmer role with read-only constraints and agent communication capability
- All Claude Code launches now use `--dangerously-skip-permissions --model sonnet`
- Actions API returns grouped turns (`extractActionTurns`) instead of flat action list
- Sequential supervisor loop (`setTimeout` chain) replaced `setInterval` to prevent double-messaging

### Fixed
- JSONL cross-contamination: supervisor and subagent JONLs no longer picked up as the primary session's JSONL
- Double-messaging supervisor: sequential loop + `reviewing` flag + mtime snapshots prevent sending before previous review completes
- Center pane overflow: `min-width: 0` + `overflow: hidden` on grid children prevents long text from blowing out column widths
- Plan file cross-contamination: plans now matched by session slug, not "most recent globally"

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
