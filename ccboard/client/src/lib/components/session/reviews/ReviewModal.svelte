<script lang="ts">
  import type { NormalisedReport, Finding, CouncilMemberScore } from "../../../types/reports";
  import Modal from "../../shared/Modal.svelte";
  import FindingItem from "./FindingItem.svelte";

  let { report, open = false, onclose }: {
    report: NormalisedReport | null;
    open: boolean;
    onclose: () => void;
  } = $props();

  const ICONS: Record<string, string> = {
    ok: "✓", warning: "⚠", issue: "⚠", critical: "✗",
  };

  let isVerdict = $derived(report?.category === "council-verdict");
  let title = $derived(
    report ? (isVerdict ? "⚖ " : (ICONS[report.status] ?? "") + " ") + report.category.toUpperCase().replace(/-/g, " ") : ""
  );

  // Group findings by _group
  let groupedFindings = $derived.by(() => {
    if (!report?.findings) return new Map<string, Finding[]>();
    const groups = new Map<string, Finding[]>();
    for (const f of report.findings) {
      const g = f._group ?? "current";
      const arr = groups.get(g) ?? [];
      arr.push(f);
      groups.set(g, arr);
    }
    return groups;
  });

  const GROUP_LABELS: Record<string, string> = {
    "new": "New Findings",
    "unchanged": "Unchanged",
    "resolved": "Resolved",
    "current": "Findings",
    "fix-now": "Fix Now",
    "fix-sprint": "Fix This Sprint",
    "track": "Track",
    "noted": "Noted",
  };

  // Council scores (verdict only)
  let councilScores = $derived.by(() => {
    if (!report || !isVerdict) return null;
    return report.council_status ?? report.council_scores ?? report.councilMembers ?? null;
  });

  // Executive summary (verdict only)
  let execSummary = $derived(
    isVerdict ? (report?.executive_summary ?? (typeof report?.summary === "string" ? report.summary : "")) : ""
  );

  function scoreIcon(data: CouncilMemberScore | string): { icon: string; color: string } {
    const score = typeof data === "string" ? data : (data.verdict ?? data.score ?? data.status ?? data.rating ?? "?");
    if (["PASS", "pass", "ok"].includes(score)) return { icon: "✓", color: "var(--green-dim)" };
    if (["WARN", "warn", "warning"].includes(score)) return { icon: "⚠", color: "var(--amber-dim)" };
    if (["FAIL", "fail", "critical"].includes(score)) return { icon: "✗", color: "var(--red-dim)" };
    return { icon: "?", color: "var(--text-dim)" };
  }
</script>

<Modal {open} {onclose} {title}>
  {#if report}
    <!-- Summary / Executive Summary -->
    {#if isVerdict && execSummary}
      <div class="section">
        <div class="section-title">Executive Summary</div>
        <div class="summary-text">{execSummary}</div>
      </div>
    {:else if !isVerdict && typeof report.summary === "string" && report.summary}
      <div class="section">
        <div class="section-title">Summary</div>
        <div class="summary-text">{report.summary}</div>
      </div>
    {/if}

    <!-- Metadata -->
    {#if report.anchor?.commitHash || report.new_head || report.verdict || report.scale_projections}
      <div class="section">
        <div class="section-title">Details</div>
        {#if report.anchor?.commitHash}
          <div class="meta-row"><span class="meta-label">Anchor</span><span class="meta-value">{report.anchor.commitHash.slice(0, 7)}</span></div>
        {/if}
        {#if report.new_head}
          <div class="meta-row"><span class="meta-label">Head</span><span class="meta-value">{String(report.new_head).slice(0, 7)}</span></div>
        {/if}
        {#if report.verdict}
          <div class="meta-row"><span class="meta-label">Verdict</span><span class="meta-value">{String(report.verdict).toUpperCase()}</span></div>
        {/if}
        {#if report.scale_projections?.safe_concurrent_calls}
          <div class="meta-row"><span class="meta-label">Safe concurrency</span><span class="meta-value">{report.scale_projections.safe_concurrent_calls}</span></div>
        {/if}
        {#if report.scale_projections?.bottleneck_component}
          <div class="meta-row"><span class="meta-label">Bottleneck</span><span class="meta-value">{report.scale_projections.bottleneck_component}</span></div>
        {/if}
      </div>
    {/if}

    <!-- Council Scores (verdict only) -->
    {#if councilScores}
      <div class="section">
        <div class="section-title">Council Scores</div>
        {#each Object.entries(councilScores) as [member, data]}
          {@const si = scoreIcon(data as CouncilMemberScore)}
          <div class="score-row">
            <span class="score-icon" style:color={si.color}>{si.icon}</span>
            <span class="score-member">{member.replace(/-/g, " ").replace(/_/g, " ")}</span>
            {#if typeof data === "object" && data !== null}
              {@const d = data as CouncilMemberScore}
              <span class="score-detail">{d.trust_score ?? d.top_finding ?? d.topFinding ?? ""}</span>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    <!-- Findings grouped by _group -->
    {#if groupedFindings.size > 0}
      {#each [...groupedFindings] as [group, findings]}
        <div class="section">
          <div class="section-title">{GROUP_LABELS[group] ?? group} ({findings.length})</div>
          {#each findings as finding}
            <FindingItem {finding} />
          {/each}
        </div>
      {/each}
    {:else}
      <div class="section">
        <div class="section-title">Findings</div>
        <div class="no-findings">No issues found</div>
      </div>
    {/if}

    <!-- Conflicts (verdict only) -->
    {#if isVerdict}
      {@const conflicts = report.conflicts_and_resolutions ?? report.conflicts ?? []}
      {#if Array.isArray(conflicts) && conflicts.length > 0}
        <div class="section">
          <div class="section-title">Conflicts & Resolutions ({conflicts.length})</div>
          {#each conflicts as c}
            <div class="conflict">
              <div class="conflict-area">{c.area ?? c.topic ?? ""}</div>
              <div class="conflict-resolution">{c.resolution ?? c.verdict ?? ""}</div>
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  {/if}
</Modal>

<style>
  .section { margin-bottom: 12px; }
  .section-title {
    font-size: 9px; text-transform: uppercase;
    letter-spacing: 1px; color: var(--text-dim);
    margin-bottom: 6px; padding-bottom: 3px;
    border-bottom: 1px solid var(--border);
  }

  .summary-text { font-size: 11px; color: var(--text); line-height: 1.5; }

  .meta-row { display: flex; gap: 12px; padding: 3px 0; font-size: 10px; }
  .meta-label { color: var(--text-dim); min-width: 100px; }
  .meta-value { color: var(--text-bright); }

  .score-row {
    display: flex; gap: 8px; padding: 4px 6px;
    background: var(--bg); margin-bottom: 1px;
    align-items: baseline;
  }
  .score-icon { font-size: 11px; }
  .score-member {
    font-size: 10px; color: var(--text-bright);
    min-width: 120px; text-transform: uppercase;
    letter-spacing: 1px;
  }
  .score-detail { font-size: 10px; color: var(--text-dim); flex: 1; }

  .no-findings { color: var(--text-dim); font-size: 10px; padding: 12px; text-align: center; }

  .conflict {
    padding: 6px 8px; background: var(--bg);
    margin-bottom: 2px; font-size: 10px;
  }
  .conflict-area { color: var(--text-bright); margin-bottom: 3px; }
  .conflict-resolution { color: var(--text-dim); }
</style>
