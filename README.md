# ccboard

A real-time command center for concurrent [Claude Code](https://docs.anthropic.com/en/docs/claude-code) sessions. Monitor, control, and supervise multiple AI coding agents from a single browser tab.

## What it does

ccboard gives you three things:

1. **Dashboard** — see all your Claude Code sessions at a glance, know which need attention
2. **Session workspace** — three-pane view: supervisor chat, agent trace graph, agent chat
3. **Supervisor** — a paired Claude Code session that watches over the agent, reviews code, tracks goals, and catches drift

## The problem

Running 3–5+ Claude Code sessions concurrently in terminal tabs creates:
- **Cognitive switching cost** — re-loading context every time you switch tabs
- **Forgotten sessions** — agent finishes, waits for input, you don't notice for 10 minutes
- **Context loss** — you come back to a session and can't remember where you left off
- **No oversight** — the agent works unsupervised; you discover problems late

## Quick start

```bash
cd ccboard
npm install
node server.js
# → ccboard running → http://localhost:3200
```

### Launch a session

Click **NEW SESSION**, enter a working directory. ccboard launches a Claude Code agent + supervisor as a paired tmux session. The supervisor starts automatically.

### Resume a session

Click **RESUME SESSION** — both agent and supervisor resume with their prior conversation context.

### Attach directly

Every managed session shows a `tmux attach -t ...` command. Click to copy. Open any terminal, paste, you're in — even if ccboard crashes.

## Architecture

```
ccboard/
├── server.js                 # Express API: session detection, tmux management, SSE streaming
├── public/
│   ├── index.html            # Dashboard: all sessions at a glance
│   ├── session.html          # Session workspace: three-pane layout
│   └── file-graph.bundle.js  # Sigma.js graph visualization (built with esbuild)
├── src/
│   └── file-graph.js         # Graph source: file tree + agent trace + node popups
└── package.json
```

### Per-project state

Each supervised project gets a `.ccboard/` folder (gitignored) containing:
- `session.json` — agent ↔ supervisor session ID pairing
- `review.json` — latest combined code review
- `{category}.json` — individual review outputs (codeQuality, security, scalability, contextDrift)
- `notes.md` — supervisor's running notes and observations

### Key technologies
- **Express** — API server
- **tmux** — universal session transport (works with any terminal app)
- **Sigma.js + Graphology** — WebGL file graph visualization (bundled with esbuild)
- **Server-Sent Events** — real-time chat streaming
- **marked.js + highlight.js** — markdown rendering with syntax highlighting
- **Claude Code JSONL** — reads `~/.claude/sessions/` and `~/.claude/projects/` for session state

## Session workspace

Three-pane layout with resizable borders:

| Left | Center | Right |
|------|--------|-------|
| **Supervisor chat** | **Agent trace** (file graph) | **Agent chat** |
| Talk to the supervisor, plan, review | Interactive graph of project files — lit nodes show agent's path | Full conversation with the agent, send messages |
| | **Reviews** (below graph) | |
| | Code review outputs from supervisor subagents | |

### Agent trace graph

The center pane shows an interactive file graph (Sigma.js) that traces the agent's path through the codebase:
- Untouched files are nearly invisible
- Files the agent touched glow with recency-based brightness (last 40 actions)
- Color-coded by action: cyan = read, amber = edit, purple = write, green = grep
- Cyan path edges connect nodes in the order the agent visited them
- Click any lit node → popup with timeline, action details, and diffs
- Arrow keys navigate between nodes in the path

## Roadmap

See [PHASES.md](PHASES.md) for the phase roadmap and [SUBAGENTS.md](SUBAGENTS.md) for the supervisor's subagent architecture.

**Next:** 5 subagent categories — MICRO code analysis, MACRO architecture review, 10th Man adversarial testing, CC failure tracking, Human failure tracking. First-run deep scan + incremental diffs.

## License

MIT
