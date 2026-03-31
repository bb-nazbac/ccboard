# ccboard — Phases

## Phase 1: Awareness Dashboard (complete)

Read-only dashboard showing all active Claude Code sessions. Session detection via `~/.claude/sessions/*.json` + process state. Status inference (waiting/working/idle). Stale session escalation. Browser notifications. Hacker aesthetic UI.

## Phase 2: Session Control (complete)

Launch and resume sessions via tmux. Send messages from the browser. Session detail view with action log, message chain, context stats. tmux as universal transport (works with any terminal app). Rescue commands for direct terminal access.

## Phase 3: Supervisor + Agent Trace (complete)

Interactive supervisor as a paired Claude Code session. Three-pane workspace (supervisor / graph+reviews / agent). File graph visualization with Sigma.js — traces agent's path through the codebase with recency-based glow, node popups with diffs, arrow key navigation. Real-time chat via SSE. Rich markdown rendering. Resizable panes. Light/dark theme + command palette. Paired session management. Auto-reconnect on server restart. Live pane streaming.

---

## Phase 4: Intelligent Supervision (next)

### 4A: Subagent Analysis System

See [SUBAGENTS.md](SUBAGENTS.md) for the full architecture.

cc-sup orchestrates 5 categories of read-only subagents that analyse the codebase and human/agent behaviour. Each category is a **template** that cc-sup adapts to the specific repo's language, framework, scale, and goals.

**The 5 categories:**

| # | Category | Focus | Output |
|---|----------|-------|--------|
| 1 | **MICRO** | Function-level code behaviour — inefficiencies, security, silent failures, scalability | Structured findings with file:line, severity, evidence |
| 2 | **MACRO** | Architecture & design — coupling, abstractions, data flow, system scalability | Same structure, higher abstraction |
| 3a | **10TH MAN MICRO** | Adversarial — assumes a bug exists, finds it | Findings with confidence + impact ratings |
| 3b | **10TH MAN MACRO** | Adversarial — assumes the architecture is flawed, finds evidence | Same with confidence + impact |
| 4 | **CC FAILURES** | Tracks what cc said vs what it did — silent substitutions, hard-coded cheats, skipped steps | Timeline of discrepancies |
| 5 | **HUMAN FAILURES** | Tracks human behaviour — vagueness, contradictions, lazy delegation, missing criteria | Flagged patterns with suggestions |

**First run:** Deep scan of entire codebase. Committed to active branch.
**Incremental runs:** Diff-based. Reads prior findings + changed files. Faster, cheaper.

**Storage:** `.ccboard/reports/{category}/latest.json` + `history/` archive. All gitignored.

**Prerequisite:** Repo must have a git remote (GitHub). ccboard enforces this on session launch.

### 4B: Intent & Progress Tracking

cc-sup maintains persistent files that survive context resets:
- `.ccboard/project.md` — project goal, plan, milestones
- `.ccboard/tasks.md` — task log with status
- `.ccboard/bottlenecks.md` — current blockers (real-world + execution)
- `.ccboard/history.md` — session-by-session progress log

These inform all subagent runs — the subagents check code against stated intent.

### 4C: Quality Gate (future)

cc-sup intercepts agent responses before they reach the human. Checks against subagent warnings and tracked intent. Sends tagged `[SUPERVISOR]` corrections to the agent if needed.

### 4D: Human Behaviour Tracking (future)

cc-sup observes the human's patterns — vagueness, contradictions, scope changes — and provides proactive guidance. Logged to `.ccboard/human-patterns.md`.

### 4E: Dynamic Prompting (future)

Human messages route through cc-sup for enrichment before reaching the agent. cc-sup adds project context, task context, and learned patterns.

---

## Implementation Plan

### Step 1: Subagent templates + first-run deep scan (4A)
- Build the 5 subagent prompt templates in `.ccboard/templates/`
- cc-sup adapts templates based on repo analysis (language, framework, structure)
- First-run deep scan produces `latest.json` per category
- Auto-commit initial analysis
- Enforce git remote requirement on session launch

### Step 2: Incremental runs (4A continued)
- Detect changes via git diff + JSONL activity
- Subagents receive prior findings + diff
- Produce updated findings (resolved, new, carried)
- UI shows findings in the reviews panel

### Step 3: Intent tracking (4B)
- cc-sup maintains project.md, tasks.md, bottlenecks.md
- Updated through conversation with the human
- Subagents read these files for context

### Step 4: Quality gate (4C)
- Detect agent turn completion
- cc-sup reviews against warnings + intent
- Tagged messages for corrections

### Step 5: Dynamic prompting (4E)
- Route human messages through cc-sup
- Enrich with project context and patterns
