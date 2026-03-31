# ccboard — Supervisor Subagent Architecture

## Overview

The supervisor (cc-sup) delegates analysis to 5 categories of read-only subagents. Each subagent is a **template** that cc-sup adapts to the specific repo (language, framework, scale, project goals). Subagents read code and produce structured outputs stored in `.ccboard/reports/`. They never write project code.

**Prerequisite:** The repo must be connected to GitHub. ccboard enforces this — sessions cannot be launched on repos without a git remote.

---

## The 5 Subagent Categories

### 1. MICRO — Code Behaviour Analysis

**Goal:** Map code behaviour at the function/module level. Detect problems that compile but cause unexpected runtime behaviour.

**What it checks:**
- Inefficiencies in hot paths (unnecessary allocations, redundant computations)
- Security vulnerabilities (injection, auth bypass, data exposure)
- Silent failures (swallowed errors, missing edge cases, incorrect fallbacks)
- Type coercion / casting issues that produce unexpected results
- Race conditions, deadlocks, shared state mutations
- Off-by-one, boundary conditions, null/undefined propagation
- Behaviour that contradicts stated intent (function says it does X, actually does Y)

**Scalability & efficiency focus:**
- O(n²)+ in loops over data that could grow
- Unbounded queries, missing pagination
- Synchronous blocking in async contexts
- N+1 query patterns
- Memory leaks (event listeners, closures, caches without eviction)

**Adaptation by repo:** The template describes what to look for generically. cc-sup adapts it based on:
- Language (Python: GIL issues, type hints vs runtime; Rust: lifetime issues, unsafe blocks; Elixir: process mailbox overflow, GenServer bottlenecks; TS: any casts, promise swallowing)
- Framework (Next.js: SSR hydration mismatches; Phoenix: LiveView memory; Django: ORM N+1)
- Scale (MVP: flag but don't block; production: strict)

### 2. MACRO — Architecture & Design Analysis

**Goal:** Critique the system at the design level. Challenge scalability, separation of concerns, coupling, and alignment with the project's trajectory.

**What it checks:**
- Coupling between modules that should be independent
- Shared mutable state across boundaries
- Missing abstractions (3+ copies of similar logic)
- Wrong level of abstraction (over-engineering or under-engineering for the project's scale)
- Data flow bottlenecks (single-threaded processing of parallel-capable work)
- Schema design issues (denormalization tradeoffs, missing indexes for known query patterns)
- Deployment architecture concerns (monolith doing microservice work, or vice versa)
- Technical debt that compounds (workarounds that make the next feature harder)

**Scalability focus:**
- Will this architecture handle 10x the current load?
- What breaks first under scale?
- Are there single points of failure?
- Is the data model going to need a migration when we grow?

**Adaptation by repo:** Same repo-awareness as MICRO, but at the system level. cc-sup considers the project's scale ambition (stated in `.ccboard/project.md`) and critiques the architecture against that ambition, not against current usage.

### 3. 10TH MAN — Adversarial Analysis (2 subagents)

**Concept:** If 9 people agree, the 10th person's duty is to assume they're wrong and find evidence. These subagents ASSUME something is wrong and work to find it, no matter how unlikely.

#### 3a. 10th Man MICRO

**Goal:** Assume the code has a bug at the function/module level. Find it.

**Approach:**
- Pick the most "obviously correct" code paths and try to break them
- Construct edge cases the original author didn't consider
- Trace data flow looking for where assumptions break
- Check error handling by assuming the error WILL happen
- Look for implicit assumptions about input shape, ordering, timing

**Output includes:**
- Confidence rating: LOW / MEDIUM / HIGH — how confident the subagent is that this is a real bug
- Impact rating: LOW / MEDIUM / HIGH / CRITICAL — how bad it would be if this bug manifests

#### 3b. 10th Man MACRO

**Goal:** Assume the architecture is flawed. Find evidence.

**Approach:**
- Assume the chosen tech stack is wrong for this project — find evidence
- Assume the data model won't scale — find where it breaks
- Assume the deployment strategy has a fatal flaw — find it
- Look for systemic risks that no single function reveals
- Challenge fundamental decisions (why is this a monolith? why this database? why this framework?)

**Output includes:**
- Confidence: LOW / MEDIUM / HIGH
- Impact: LOW / MEDIUM / HIGH / CRITICAL

### 4. CC FAILURES — Agent Behaviour Tracking

**Goal:** Track what Claude Code (cc) said vs what it actually did. Surface silent failures from the human's perspective.

**What it tracks:**
- cc's tool call history: what it Read, Wrote, Edited, Grepped, and in what order
- Discrepancies between cc's stated plan and its actions ("I'll use library X" → actually used library Y)
- Hard-coded values that should be dynamic (cc couldn't figure it out and cheated)
- Silent model substitutions (asked for GPT-5, used GPT-4o without saying)
- Skipped steps (cc said it would do A, B, C — but only did A and C)
- Retry patterns that indicate cc is struggling (edited the same file 5 times)
- cc abandoned an approach without telling the human
- cc loaded unnecessary files into context (wasting tokens)

**How it works:**
- Reads the agent's JSONL chronologically
- Cross-references cc's text responses against its tool calls
- Looks for patterns: "I'll do X" followed by not doing X
- Tracks the ordered sequence of actions and flags anomalies

**Output:** A timeline of flagged behaviours with:
- What cc said it would do
- What cc actually did
- The discrepancy
- Severity: INFO / WARNING / ISSUE

### 5. HUMAN FAILURES — Human Behaviour Tracking

**Goal:** Track the human's behaviour and flag logical fallacies, vagueness, contradictions, and laziness.

**What it tracks:**
- Vague instructions ("make it better", "fix the thing") without specifics
- Contradictory requests (asked for X in message 5, asked for not-X in message 12)
- Scope changes without acknowledging the previous scope
- Lazy delegation (human stops providing context, expects cc to infer everything)
- Missing acceptance criteria (human asks for a feature but never defines "done")
- Assumptions the human makes that aren't grounded (references files that don't exist, assumes APIs that aren't available)
- Emotional decision-making (human is frustrated → makes hasty decisions)

**Output:** A log of flagged patterns with:
- The human's message that triggered the flag
- The pattern identified
- Suggestion for how the human could be clearer
- Severity: NOTE / WARNING / ISSUE

---

## Structured Output Format

All subagents produce the same JSON structure, stored in `.ccboard/reports/`:

```json
{
  "category": "micro|macro|10th-man-micro|10th-man-macro|cc-failures|human-failures",
  "runType": "deep-scan|incremental",
  "timestamp": "2026-03-31T10:30:00Z",
  "duration": "45s",
  "scanScope": {
    "filesChecked": ["src/auth.ts", "src/db/users.ts"],
    "linesAnalyzed": 1250,
    "changedSinceLastRun": ["src/auth.ts"],
    "previousRunRef": "2026-03-31T09:00:00Z"
  },
  "summary": "1-2 sentence overview of findings",
  "findings": [
    {
      "id": "micro-001",
      "severity": "low|medium|high|critical",
      "confidence": "low|medium|high",
      "location": "src/auth.ts:142",
      "title": "Short description",
      "description": "Detailed explanation of the issue",
      "evidence": "The actual code snippet or behaviour observed",
      "impact": "What happens if this issue manifests",
      "suggestion": "How to fix it",
      "relatedFindings": ["macro-003"]
    }
  ],
  "metrics": {
    "totalFindings": 3,
    "bySeverity": { "low": 1, "medium": 1, "high": 1, "critical": 0 },
    "byConfidence": { "low": 0, "medium": 2, "high": 1 },
    "resolved": 1,
    "new": 2,
    "carried": 0
  }
}
```

### File Storage

```
.ccboard/
├── reports/
│   ├── micro/
│   │   ├── latest.json          ← most recent run
│   │   └── history/
│   │       ├── 2026-03-31T10-30.json
│   │       └── 2026-03-31T09-00.json
│   ├── macro/
│   │   ├── latest.json
│   │   └── history/
│   ├── 10th-man-micro/
│   │   ├── latest.json
│   │   └── history/
│   ├── 10th-man-macro/
│   │   ├── latest.json
│   │   └── history/
│   ├── cc-failures/
│   │   ├── latest.json
│   │   └── history/
│   └── human-failures/
│       ├── latest.json
│       └── history/
├── project.md
├── tasks.md
├── bottlenecks.md
├── history.md
├── session.json
└── review.json          ← combined summary (for UI)
```

All of `.ccboard/` is gitignored. Reports persist across supervisor restarts.

---

## First Run vs Incremental Runs

### First Run (deep scan)

1. cc-sup kicks off all subagents in parallel
2. Each subagent does a **full codebase scan**:
   - Reads project structure
   - Reads all relevant source files
   - Analyses from scratch
3. Each writes its `latest.json` + copies to `history/`
4. cc-sup reads all 5 results, writes `review.json` (combined summary)
5. **cc-sup commits to the active branch** with message: `chore(ccboard): initial code analysis [skip ci]`

### Incremental Runs (subsequent)

1. cc-sup detects changes (new commits, modified files, JSONL activity)
2. Kicks off subagents with context:
   - Previous `latest.json` (their prior findings)
   - `git diff <last-commit>..HEAD` (what changed)
   - `git diff` + `git diff --staged` (uncommitted changes)
3. Each subagent:
   - Reads its prior findings
   - Checks which findings are still valid (re-reads affected files)
   - Scans only changed/affected areas for new findings
   - Marks resolved findings
   - Returns updated `latest.json`
4. cc-sup writes combined `review.json`
5. Does NOT auto-commit incremental runs (too noisy)

---

## cc-sup's Role

cc-sup is the **orchestrator**, not the analyser. It:

1. **Adapts templates** to the repo: reads the codebase language/framework/structure and customises each subagent's prompt
2. **Schedules runs**: kicks off subagents on first start, then on detected changes
3. **Reads results**: combines outputs into a unified view
4. **Surfaces warnings**: highlights critical/high findings to the human
5. **Maintains context**: keeps `.ccboard/project.md`, `tasks.md`, `bottlenecks.md` updated

cc-sup does NOT:
- Write project code
- Run subagents without being asked (after the first deep scan)
- Auto-fix issues
- Message the agent without human approval

---

## GitHub Requirement

ccboard enforces: **sessions can only be launched on repos with a git remote.**

On `/api/launch`, the server checks:
```bash
git remote get-url origin 2>/dev/null
```
If this fails, the launch is rejected with: "This repo is not connected to GitHub. ccboard requires a git remote for commit tracking and change detection."

This ensures:
- We can track changes via git diff
- The initial deep scan can be committed
- The subagents have a reliable baseline (committed state) to diff against
