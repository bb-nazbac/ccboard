# ccboard — Phases

## Phase 1: Awareness Dashboard (current)

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

## Phase 2 (planned)
TBD — likely: context summaries, activity feed, session naming.

## Phase 3 (planned)
TBD — likely: session launching, click-to-focus, deeper integration.
