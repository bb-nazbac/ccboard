# ccboard — Analysis Framework

## Output Structure

Every subagent produces a JSON file with the same envelope structure. The UI reads the envelope for the review rows. The detail popup reads the domain-specific payload.

### Common Envelope

```json
{
  "id": "micro-2026-04-01T10-30-00",
  "category": "micro",
  "displayName": "MICRO — Code Behaviour",
  "runType": "deep-scan|incremental",
  "status": "ok|warning|issue|critical",
  "summary": "Found 3 issues: 1 high severity race condition in auth flow, 2 medium inefficiencies in query layer",
  "timestamp": "2026-04-01T10:30:00Z",
  "duration": "45s",
  "anchor": {
    "commitHash": "a1b2c3d",
    "commitMessage": "feat: add parallel dialer",
    "committedAt": "2026-04-01T10:25:00Z"
  },
  "scope": {
    "runScope": "full|changed-only",
    "filesAnalysed": ["src/auth.ts", "src/db/users.ts", "src/dialer/pool.ts"],
    "filesChanged": ["src/auth.ts"],
    "linesAnalysed": 1250,
    "previousRunId": "micro-2026-04-01T09-00-00"
  },
  "metrics": {
    "total": 3,
    "new": 2,
    "carried": 1,
    "resolved": 0,
    "bySeverity": { "low": 0, "medium": 2, "high": 1, "critical": 0 },
    "byConfidence": { "low": 0, "medium": 1, "high": 2 }
  },
  "findings": [...]
}
```

### The `anchor` Field

This is how we track what the analysis was run against.

```json
"anchor": {
  "commitHash": "a1b2c3d",
  "commitMessage": "feat: add parallel dialer",
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

## Domain-Specific Finding Structures

### MICRO + MACRO Findings

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
├── anchors.json              ← tracks commit anchors across runs
├── project.md
├── tasks.md
├── bottlenecks.md
├── session.json
└── review.json               ← combined summary for the UI
```

### `anchors.json`

Tracks the relationship between analysis runs and git state:

```json
{
  "current": {
    "commitHash": "a1b2c3d",
    "committedAt": "2026-04-01T10:25:00Z",
    "analysedAt": "2026-04-01T10:30:00Z"
  },
  "history": [
    {
      "commitHash": "x9y8z7w",
      "committedAt": "2026-04-01T09:00:00Z",
      "analysedAt": "2026-04-01T09:05:00Z"
    }
  ]
}
```

On each run:
1. Read `anchors.json` → get `current.commitHash`
2. `git diff <current.commitHash>..HEAD` → committed changes since last analysis
3. `git diff` + `git diff --staged` → uncommitted changes
4. Both passed to subagents
5. After run: update `anchors.json` with new anchor

### `review.json` — Combined UI Summary

The UI reads this single file to populate the review rows:

```json
{
  "lastUpdated": "2026-04-01T10:30:00Z",
  "categories": [
    {
      "category": "micro",
      "displayName": "MICRO — Code Behaviour",
      "status": "warning",
      "summary": "3 findings (1 high, 2 medium)",
      "lastRun": "2026-04-01T10:30:00Z",
      "metrics": { "total": 3, "new": 2, "carried": 1, "resolved": 0 }
    },
    {
      "category": "macro",
      "displayName": "MACRO — Architecture",
      "status": "ok",
      "summary": "No issues",
      "lastRun": "2026-04-01T10:30:00Z",
      "metrics": { "total": 0 }
    }
  ]
}
```

The UI renders each entry as a review row. Click → loads `.ccboard/reports/{category}/latest.json` for the full detail popup.

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

1. `latest.json` updated
2. Copy saved to `runs/` with timestamp
3. `review.json` regenerated from all `latest.json` files
4. `anchors.json` updated with current commit hash
5. UI refreshes automatically (reads `review.json`)
