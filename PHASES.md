# ccboard — Phases

## Phase 1: Awareness Dashboard (complete)

Read-only dashboard showing all active Claude Code sessions. Session detection via `~/.claude/sessions/*.json` + process state. Status inference (waiting/working/idle). Stale session escalation. Browser notifications. Hacker aesthetic UI.

## Phase 2: Session Control (complete)

Launch and resume sessions via tmux. Send messages from the browser. Session detail view with action log, message chain, context stats. tmux as universal transport (works with any terminal app). Rescue commands for direct terminal access.

## Phase 3: Supervisor + Agent Trace (complete)

Interactive supervisor as a paired Claude Code session. Three-pane workspace (supervisor / graph+reviews / agent). File graph visualization with Sigma.js — traces agent's path through the codebase with recency-based glow, node popups with diffs, arrow key navigation. Real-time chat via SSE. Rich markdown rendering. Resizable panes. Paired session management with `.ccboard/session.json`. Auto-reconnect on server restart.

---

## Phase 4: Intelligent Supervisor (next)

The supervisor evolves from a reactive pair programmer into an active project manager that tracks intent, detects drift, and gates quality.

### 4A: Intent & Progress Tracking

The supervisor must deeply understand what the human wants and where the project is.

**Project level:**
- Track the overarching goal for the repo (what are we building, why, for whom)
- Maintain a project plan with milestones
- Track history: what has been accomplished across sessions

**Task level:**
- Track the current task (what the human just asked for in this message)
- Track task progress: started → in progress → blocked → done
- Link tasks to the project plan (does this task advance the goal?)

**Bottleneck tracking (two categories):**
1. **Real-world constraints** — things we can't control. "The API doesn't support batch operations." "The library doesn't have TypeScript types." "The client wants it by Friday."
2. **Execution blockers** — things we're stuck on right now. "This feature isn't working because of X." "We need to refactor Y before we can build Z." "Claude Code took a wrong approach and now we need to unwind it."

**Storage:** All tracked in `.ccboard/` as markdown or YAML files:
- `.ccboard/project.md` — project goal, plan, milestones
- `.ccboard/tasks.md` — task log with status
- `.ccboard/bottlenecks.md` — current blockers (real-world + execution)
- `.ccboard/history.md` — session-by-session progress log

### 4B: Independent Agent Supervision

A supervisor subagent runs continuously in the background, watching the agent's actions in real-time.

**What it watches for:**
- **Hotfix traps** — the agent ships a quick fix that solves the immediate task but creates debt or contradicts the project plan. Flag: "this fixes the symptom but makes the parallel dialer harder to build later."
- **Context waste** — the agent loads files into context that it doesn't need. Flag: "the agent just read 5 files it won't use, burning context window."
- **Silent substitutions** — the agent does something different from what was asked and doesn't mention it. Example: user asked for GPT-5 mini, agent uses GPT-4o mini without saying so. Flag: "the agent switched models without telling you."
- **Drift from intent** — the agent builds for a single dialer when the user wanted a parallel dialer. The subagent catches this because it's tracking the user's intent from 4A.
- **Scope creep** — the agent starts refactoring code that wasn't part of the task. Flag: "the agent is restructuring the auth module — this wasn't requested."

**How it works:**
- A read-only subagent spawned by the supervisor
- Reads the agent's JSONL in real-time (via file watching)
- Cross-references each action against: the current task, the project plan, the user's stated intent
- Writes warnings to `.ccboard/warnings.md` and surfaces them in the UI
- Does NOT interrupt the agent — it surfaces warnings to the supervisor and the human

### 4C: Quality Gate (Supervisor ↔ Agent)

The supervisor sits between Claude Code and the human. When the agent finishes a turn:

1. The supervisor reads the agent's response
2. It checks against: the warnings from 4B, the current task requirements, the project plan
3. If something is off, it sends a tagged message to the agent: `[SUPERVISOR] You used GPT-4o mini but the user asked for GPT-5 mini. Please fix before responding to the human.`
4. The agent corrects and responds
5. Only then does the response reach the human

**Message tagging:** All messages in the system are tagged:
- `[HUMAN]` — messages from the user
- `[SUPERVISOR]` — messages from the supervisor
- `[AGENT]` — responses from the agent

This is visible in both the UI and the actual tmux sessions.

### 4D: Human Behavior Tracking

The supervisor starts observing the human too:

- **What the human asks for** — tracking patterns in requests, priorities, decision-making
- **Human pitfalls** — the human keeps forgetting to commit, or keeps changing requirements mid-task, or asks for things that contradict earlier decisions
- **Communication patterns** — how the human phrases requests, what they tend to leave ambiguous, what they assume the agent knows

**Purpose:** The supervisor learns what kind of guidance to give proactively. If the human tends to forget about error handling, the supervisor reminds the agent to include it. If the human changes direction frequently, the supervisor confirms the change before the agent acts.

**Storage:** `.ccboard/human-patterns.md` — learned patterns and pitfalls

### 4E: Dynamic Prompting (future)

The final evolution: the supervisor reformats the human's message before it reaches the agent.

- Human types: "add the login page"
- Supervisor enriches: "Add the login page. Context: we're building a Next.js app with Convex auth. The design system uses Tailwind + shadcn. The relevant files are src/app/(auth)/login/page.tsx (doesn't exist yet) and src/lib/auth.ts. The login flow should use the magic link pattern we discussed in task #12. Do not modify the existing signup flow."

This is **dynamic prompting** — the supervisor uses its knowledge of the project, the plan, the task history, and the human's patterns to produce a better prompt than the human wrote.

---

## Implementation plan for Phase 4

### Step 1: Intent tracking (4A)
- Add `.ccboard/project.md` and `.ccboard/tasks.md` templates
- Update supervisor system prompt to maintain these files
- When supervisor starts, it reads these files to understand context
- After each human message, supervisor updates task status

### Step 2: Background watcher (4B)
- Spawn a read-only subagent that watches the agent's JSONL via file events
- Subagent reads `.ccboard/project.md` and `.ccboard/tasks.md` for context
- Writes warnings to `.ccboard/warnings.md`
- UI shows warnings in the reviews panel

### Step 3: Quality gate (4C)
- Detect when agent finishes a turn (❯ prompt in tmux pane)
- Supervisor reads agent's last response + any warnings
- If action needed: supervisor sends tagged `[SUPERVISOR]` message to agent
- If clean: response passes through to human

### Step 4: Human tracking (4D)
- Supervisor logs human patterns to `.ccboard/human-patterns.md`
- Patterns inform the supervisor's guidance to the agent

### Step 5: Dynamic prompting (4E)
- Human messages route through supervisor before reaching agent
- Supervisor enriches with project context, task context, and learned patterns
