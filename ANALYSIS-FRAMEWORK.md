# ccboard — Analysis Framework

## Output Structure

Each subagent produces a JSON file with its own structure optimised for its domain. The only contract with the UI is a minimal set of fields at the top level that the review rows need:

```json
{
  "category": "micro|macro|10th-man-micro|10th-man-macro|cc-failures|human-failures",
  "status": "ok|warning|issue|critical",
  "summary": "one line for the review row",
  "timestamp": "ISO timestamp of this run"
}
```

Everything beyond these 4 fields is domain-specific. The detail popup reads the full file and renders it according to the category.

The server aggregates by scanning `.ccboard/reports/*/latest.json` and reading these 4 fields. No cc-sup involvement needed for aggregation.

### Anchor

Every report should include an anchor so we know what git state it was run against. This is the only other recommended (not required) common field:

```json
"anchor": {
  "commitHash": "a1b2c3d",
  "committedAt": "2026-04-01T10:25:00Z"
}
```

- On first run: the anchor is the commit we create before the deep scan
- On incremental runs: the anchor is the commit hash at the time of the run
- To detect changes: `git diff <previous anchor hash>..HEAD` gives committed changes since last run
- Uncommitted work: `git diff` + `git diff --staged` catches staged and unstaged changes that haven't been committed yet
- Both are passed to the subagent so it sees the full picture

### Finding Lifecycle

Each finding has an `id` that persists across runs:

```
finding.id = "{category}-{file}-{line}-{hash of description}"
```

On incremental runs, the subagent receives the previous findings and must:
- **Carry** findings that still exist (same id, still valid) → `status: "carried"`
- **Resolve** findings that no longer apply (code was fixed) → `status: "resolved"`
- **Create new** findings for newly detected issues → `status: "new"`

This gives the UI a clear picture: "2 new issues, 1 carried from last run, 1 resolved."

---

## Domain-Specific Structures

Each category defines its own structure. These are examples — the subagents can evolve their structures as needed. The only hard requirement is the 4 UI fields at the top level (`category`, `status`, `summary`, `timestamp`).

### MICRO + MACRO

```json
{
  "id": "micro-src-auth-ts-142-race-cond",
  "findingStatus": "new|carried|resolved",
  "severity": "low|medium|high|critical",
  "confidence": "high",
  "location": {
    "file": "src/auth.ts",
    "line": 142,
    "endLine": 158,
    "function": "validateToken"
  },
  "title": "Race condition in token refresh",
  "description": "Two concurrent requests can both see an expired token and both trigger a refresh, causing one to fail with an invalid token error.",
  "evidence": "const token = await getToken();\nif (isExpired(token)) {\n  await refreshToken(); // no lock\n}",
  "impact": "Under concurrent load, ~1% of authenticated requests will fail silently and retry, causing double-processing.",
  "suggestion": "Add a mutex or debounce on refreshToken() so only one concurrent caller triggers the refresh.",
  "tags": ["concurrency", "auth", "silent-failure"]
}
```

### 10TH MAN Findings

Same as MICRO/MACRO but with mandatory `confidence` and `impact` ratings:

```json
{
  "id": "10th-micro-src-dialer-pool-ts-88-assumption",
  "findingStatus": "new",
  "severity": "high",
  "confidence": "medium",
  "impact": "critical",
  "location": {
    "file": "src/dialer/pool.ts",
    "line": 88
  },
  "title": "Pool assumes all connections are identical",
  "description": "The connection pool treats all SIP trunks as interchangeable. If trunk A has different rate limits than trunk B, the pool will over-allocate to A and get throttled.",
  "adversarialReasoning": "I assumed the pool has a flaw. The pool's round-robin logic doesn't account for heterogeneous trunk configurations. Testing with trunks of different capacities would expose this.",
  "evidence": "connections[nextIndex++ % connections.length]",
  "impact": "At scale (100+ concurrent calls), 30-40% of calls would route to an over-capacity trunk, causing dropped calls.",
  "suggestion": "Weight the pool distribution by trunk capacity. Add a capacity field to the trunk config.",
  "tags": ["scalability", "pool", "assumption"]
}
```

### CC FAILURES Findings

Timeline-based — each finding is a discrepancy between what cc said and what it did:

```json
{
  "id": "cc-fail-turn-47-model-substitution",
  "findingStatus": "new",
  "severity": "warning",
  "type": "silent-substitution|skipped-step|hard-coded-cheat|approach-change|context-waste",
  "turn": 47,
  "timestamp": "2026-04-01T10:15:00Z",
  "title": "Model substitution without disclosure",
  "said": {
    "message": "I'll configure the pipeline to use GPT-5 mini for the extraction step.",
    "timestamp": "2026-04-01T10:14:30Z"
  },
  "did": {
    "action": "Edit",
    "file": "src/pipeline/extract.ts",
    "line": 23,
    "detail": "Set model to 'gpt-4o-mini' in the extraction config",
    "evidence": "model: \"gpt-4o-mini\""
  },
  "discrepancy": "User asked for GPT-5 mini. Agent wrote GPT-4o-mini without mentioning the change.",
  "tags": ["model", "silent-change"]
}
```

### HUMAN FAILURES Findings

Pattern-based — each finding is a behavioural observation:

```json
{
  "id": "human-fail-turn-52-vague-instruction",
  "findingStatus": "new",
  "severity": "warning",
  "type": "vague-instruction|contradiction|scope-change|missing-criteria|lazy-delegation",
  "turn": 52,
  "timestamp": "2026-04-01T10:20:00Z",
  "title": "Vague instruction with no acceptance criteria",
  "humanMessage": "Make the dialer work better",
  "observation": "No definition of 'better'. Could mean: faster connection times, higher throughput, fewer dropped calls, better audio quality, or something else entirely.",
  "priorContext": "Previous messages discussed parallel dialing with 100 concurrent calls. 'Better' likely refers to throughput, but this is not stated.",
  "suggestion": "Specify the metric: 'Increase concurrent call capacity from 50 to 100 without increasing dropped call rate above 2%'",
  "tags": ["vague", "missing-criteria"]
}
```

---

## Storage

```
.ccboard/
├── reports/
│   ├── micro/
│   │   ├── latest.json                    ← symlink or copy of most recent
│   │   └── runs/
│   │       ├── micro-2026-04-01T10-30-00.json
│   │       └── micro-2026-04-01T09-00-00.json
│   ├── macro/
│   │   ├── latest.json
│   │   └── runs/
│   ├── 10th-man-micro/
│   │   ├── latest.json
│   │   └── runs/
│   ├── 10th-man-macro/
│   │   ├── latest.json
│   │   └── runs/
│   ├── cc-failures/
│   │   ├── latest.json
│   │   └── runs/
│   └── human-failures/
│       ├── latest.json
│       └── runs/
├── project.md
├── tasks.md
├── bottlenecks.md
└── session.json
```

### Change Detection via Anchors

Each `latest.json` contains an `anchor.commitHash` field — the git HEAD at the time of the run. On incremental runs, the subagent reads `latest.json`, extracts the anchor, and diffs against it:

1. `git diff <anchor.commitHash>..HEAD` → committed changes since last analysis
2. `git diff` + `git diff --staged` → uncommitted changes
3. Both passed to the subagent alongside the previous findings

No separate anchors file needed — the anchor lives inside each report.

### UI Aggregation

The ccboard server (not cc-sup) reads all `.ccboard/reports/*/latest.json` files, extracts the 4 common fields (`category`, `status`, `summary`, `timestamp`), and serves them as review rows. Click any row → the server returns the full `latest.json` for that category, and the UI renders the detail popup based on the category type.

No `review.json` aggregation file needed. The server reads the individual files on demand.

---

## Change Detection

### What triggers a run

The subagents should run when:
1. **Human asks cc-sup** to run a review (explicit)
2. **First session start** on a repo that has no `.ccboard/reports/` yet (automatic deep scan)

Subagents should NOT auto-run on every change — that's too expensive. The human decides when to review.

### What changes the subagents see

On each run, the subagent receives:

```
ANCHOR: commit a1b2c3d (2026-04-01T10:25:00Z)

COMMITTED CHANGES SINCE ANCHOR:
<git diff a1b2c3d..HEAD>

UNCOMMITTED CHANGES:
<git diff>
<git diff --staged>

PREVIOUS FINDINGS:
<contents of latest.json>
```

The subagent then:
1. Checks if previous findings still apply (re-reads affected files)
2. Scans changed files + any files that import/depend on changed files
3. Returns updated findings with `findingStatus: new|carried|resolved`

### After the run

1. `latest.json` updated for each category that ran (includes new anchor)
2. Copy saved to `runs/` with timestamp
3. UI refreshes automatically (server reads `latest.json` files on demand)
