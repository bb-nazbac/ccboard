# Changelog

## [0.6.0] - 2026-03-30

### Added
- **Agent trace graph** — Sigma.js + Graphology file graph in center pane traces the agent's path through the codebase
- **Recency-based glow** — last 40 file-touching actions light up with brightness proportional to recency; untouched nodes are nearly invisible
- **Cyan path edges** — dashed lines connect nodes in the order the agent visited them
- **Node click popups** — full modal with: color-coded timeline (read=cyan, edit=amber, write=purple, grep=green), action details with diffs, arrow key navigation between nodes
- **Real-time chat via SSE** — both agent and supervisor chats update instantly via Server-Sent Events (fs.watch on JSONL files), replacing polling
- **Paired session management** — /api/launch creates both agent + supervisor tmux sessions; resume resumes both using stored session IDs in `.ccboard/session.json`
- **Auto-start supervisor** — supervisor launches automatically with managed sessions, no manual start button
- **Auto-reconnect supervisor** — server reconnects to existing supervisor tmux sessions after restart
- **Rich markdown rendering** — marked.js + highlight.js from CDN; syntax-highlighted code blocks, tables, lists in both chat panes
- **Resizable panes** — drag handles between all three panes (horizontal) and between graph/reviews (vertical)
- **tmux commands in headers** — both supervisor and agent pane headers show clickable tmux attach commands
- **esbuild bundling** — Sigma.js + Graphology bundled with esbuild into a single IIFE file; no Vite, no HTML processing issues
- **Supervisor JSONL resolution** — `resolveSupervisorJsonlPath()` shared helper handles resumed sessions via pairing file
- **Write action content** — server captures file content for Write actions (1000 chars) for new-file diff display

### Fixed
- Agent chat showing supervisor messages — `findLargestJsonl()` fallback picks main conversation, not supervisor JSONL
- Supervisor messages disappearing — JSONL resolution now checks pairing file first for resumed sessions
- Graph pitch black — initial node colors brightened; random initial positions for force layout; cwd prefix stripping for path matching
- Vite breaking inline scripts — abandoned Vite, used esbuild for JS-only bundling instead

## [0.4.0] - 2026-03-29

### Added
- **Interactive supervisor** — Claude Code session you chat with, acts as pair programmer and tech lead
- **Three-pane session layout** — supervisor chat (left), graph + reviews (center), agent chat (right)
- **Read-only supervisor** — system prompt restricts to Read/Grep/Glob only, writes only to `.ccboard/`
- **Supervisor → agent messaging** — via tmux send-keys
- **`.ccboard/` persistent output** — structured review JSONs persist across restarts
- **Review detail modals** — methodology, files checked, criteria, findings with evidence
- **JSONL isolation** — path caching, supervisor noise filtering, supervisor session ID exclusion

## [0.3.0] - 2026-03-29

### Added
- **Session launching** — NEW SESSION + RESUME SESSION via tmux
- **Send messages** — tmux send-keys + paste-buffer (universal, any terminal app)
- **Rescue commands** — `tmux attach -t ...` for direct access
- **tmux pane status detection** — reads `❯` prompt for accurate waiting/working/idle

## [0.2.0] - 2026-03-29

### Added
- **Session detail view** — action log, context stats, message chain
- **Clickable session rows** on dashboard

## [0.1.0] - 2026-03-29

### Added
- Initial release: dashboard, session detection, status inference, hacker UI, browser notifications
