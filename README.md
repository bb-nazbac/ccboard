# ccboard

A real-time dashboard for monitoring concurrent [Claude Code](https://docs.anthropic.com/en/docs/claude-code) sessions. Built for humans who run 3–5+ sessions at once and need to know what's happening across all of them without switching tabs.

## The problem

If you use Claude Code heavily, you've probably hit this wall:

1. **Cognitive switching cost** — You have 4 terminal tabs open, each with a Claude session on a different repo. Every time you switch, you spend 10–30 seconds re-loading context: "what was this one doing again?"

2. **Forgotten tabs** — A session finishes its work and waits for your input. You don't notice for 5, 10, 15 minutes because you're focused on another tab. Dead time.

3. **Context loss** — You switch back to a tab you last touched 5 minutes ago. You've lost the thread. You scroll up, re-read, try to remember what you asked for.

These problems compound. With 3 sessions it's manageable. With 5+ it becomes a bottleneck — not because Claude is slow, but because _you_ are the constraint.

## The solution

ccboard is a browser-based dashboard that sits alongside your terminal. It reads Claude Code's local session state (no API keys, no network calls, no instrumentation) and shows you:

```
 ▶ Dialler              ticklish-cooking-crab     AWAITING INPUT    3m ago
                         Done. Your .env now has:                    ttys003

 ◉ paperclip            scalable-finding-finch     WORKING          just now
                         Building out phase 1...                     ttys004

 ○ tx academy           jiggly-beaming-cocoa       IDLE             12m ago
                         The conclusions come from the data...       ttys001
```

**Per session:** status (waiting/working/idle), project name, session slug, last Claude response snippet, last activity time, terminal ID.

**Across sessions:** sorted by urgency. Waiting sessions float to top. Stale sessions (waiting >5min) escalate visually from amber to red. Browser notifications fire when a session transitions from working to waiting. Page title shows `(3) ccboard` so you see the attention count from any browser tab.

## How it works

ccboard reads two data sources, both local to your machine:

1. **`~/.claude/sessions/*.json`** — Claude Code writes a file per running session with its PID, session ID, working directory, and start time. ccboard cross-references these with `ps` to determine which sessions are alive and whether they're CPU-active.

2. **`~/.claude/projects/{encoded-cwd}/{sessionId}.jsonl`** — Claude Code's conversation transcripts. ccboard tails the last 64KB of each file to extract: the last assistant message (context snippet), the timestamp of last activity, the session slug, and whether Claude finished its turn (indicating it's waiting for user input).

No modifications to Claude Code. No API keys. No background processes injected into your sessions. Pure read-only observation.

## Quick start

```bash
cd ccboard
npm install
node server.js
# → ccboard running → http://localhost:3200
```

Open http://localhost:3200 in your browser. It will immediately detect all running Claude Code sessions.

Click anywhere on the page to enable browser notifications (optional but recommended).

## Design

Terminal-inspired "2010 hacker" aesthetic: dark background, CRT scanlines, vignette, subtle screen flicker, monospace font (Share Tech Mono), amber/cyan/green color coding.

- **Amber** — session is waiting for your input
- **Cyan** — session is actively working
- **Dark** — session is idle
- **Red escalation** — session has been waiting for you for >5/10/15 minutes

## Architecture

```
ccboard/
├── server.js          # Express server: session detection + JSONL parsing
├── public/
│   └── index.html     # Single-file frontend: HTML + CSS + JS, no build step
└── package.json
```

Deliberately minimal. No React, no build tools, no database. Two files that do one thing well.

## Origin story

This project started by studying [Paperclip](https://github.com/paperclipai/paperclip) — an open-source orchestration platform for AI agent companies. Paperclip solves a related problem: giving humans visibility into what multiple AI agents are doing simultaneously. Key patterns we borrowed:

- **At-a-glance status panel** — Paperclip's `ActiveAgentsPanel` shows up to 4 agents with live indicators and transcript snippets. We adapted this into our session rows.
- **"Needs attention" signals** — Paperclip uses pulsing dots, toast notifications, and badges when an agent needs human input. We adapted this into stale escalation and browser notifications.
- **Context snapshots** — Paperclip stores a `contextSnapshot` per heartbeat run so humans can re-orient without reading full transcripts. We adapted this by tailing JSONL files for the last assistant message.

The Paperclip reference codebase is in `paperclip-ref/` (gitignored) for ongoing study.

## Phases

See [PHASES.md](PHASES.md) for the roadmap.

**Phase 1 (current):** Read-only awareness dashboard — session detection, status inference, context snippets, stale warnings, browser notifications.

**Phase 2 (planned):** Richer context — activity feed across sessions, session naming/tagging, cost tracking.

**Phase 3 (planned):** Session control — launching sessions, click-to-focus, deeper Claude Code integration.

## License

MIT
