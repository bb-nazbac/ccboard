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

## Phase 3: Interactive Supervisor + Three-Pane Layout (current)

The supervisor evolves from an automated reviewer into an interactive pair programmer. The session detail page becomes a three-pane workspace.

### Goals
- Supervisor as a thinking partner: you plan with it, it delegates execution to the agent
- Clear separation of concerns: supervisor thinks, agent executes
- Supervisor's context stays clean (no execution weight)
- Code reviews run as subagents that read code and write structured outputs to `.ccboard/`

### Features
| Feature | Status | Description |
|---|---|---|
| Three-pane layout | done | Left: supervisor chat, Center: actions (top) + reviews (bottom), Right: agent chat |
| Supervisor chat | done | Full chat interface — send messages, see responses, supervisor reads from its JSONL |
| Interactive supervisor | done | Supervisor is a Claude Code session you talk to, not an automated loop |
| Read-only supervisor | done | System prompt restricts to Read/Grep/Glob only — can only write to `.ccboard/` |
| Supervisor → agent messaging | done | Supervisor can send messages to the primary agent via tmux send-keys |
| `.ccboard/` review outputs | done | Subagents write structured reviews to `.ccboard/{category}.json` and `.ccboard/review.json` |
| Review detail modals | done | Click any review row to see methodology, files checked, criteria, findings with evidence |
| Collapsible action turns | done | All turns shown, grouped by human message, last expanded, rest collapsed |
| JSONL path caching | done | Each session's JSONL resolved once and cached by PID — prevents cross-contamination |
| Supervisor noise filtering | done | `isSupervisorNoise()` filters supervisor messages from primary session's actions/messages |
| Sequential supervisor loop | done | `setTimeout`-based loop replaces `setInterval` — no double-messaging |
| `--dangerously-skip-permissions` | done | All Claude Code launches skip permission prompts |
| `--model sonnet` | done | All launches use Sonnet 4.6 |

### Architecture
- **Supervisor = interactive Claude Code session in tmux**, not an automated review loop
- **System prompt** tells it: read-only, can spawn read-only Agent subagents, can write only to `.ccboard/`, can message the primary agent via tmux
- **`.ccboard/` folder** = the supervisor's persistent memory. Survives context resets. Contains review.json, category JSONs, notes.md
- **Three-pane UI**: supervisor chat (left), actions + reviews (center split), agent chat (right)
- **JSONL isolation**: PID → JSONL path cached on first resolution. Supervisor JONLs excluded from `findLatestJsonl`. `isSupervisorNoise()` filters at extraction level.

### Key learnings
- Automated supervisor loops are fragile: double-messaging, feedback loops, stale context. Interactive mode is simpler and more useful.
- The supervisor doesn't need execution context — it delegates to the agent. This keeps its context window clean for thinking.
- `.ccboard/` as a filesystem-based output channel is more reliable than parsing JONLs or scraping tmux panes.
- Subagent category confusion is solved by having each agent write to a named file (`.ccboard/codeQuality.json`), not by hoping the supervisor maps outputs correctly.

### Open questions for Phase 4
- **Supervisor auto-restart**: when context gets heavy, kill and restart with `.ccboard/` as carry-forward memory
- **Staying active**: how to keep the supervisor's turn alive for continuous monitoring (currently turn-based)
- **Cost tracking**: how much are the supervisor and its subagents costing per session

---

## Phase 4 (planned)
TBD — likely: supervisor context management, continuous monitoring, cross-session activity feed, cost tracking.
