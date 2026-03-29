# Changelog

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
