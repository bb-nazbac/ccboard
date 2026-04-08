<script lang="ts">
  import type { Finding } from "../../../types/reports";
  import { escapeHtml } from "../../../utils/html";

  let { finding }: { finding: Finding } = $props();

  let severity = $derived((finding.severity ?? "low").toLowerCase());
  let location = $derived.by(() => {
    const loc = finding.location;
    if (!loc) {
      if (finding.file) return finding.line ? `${finding.file}:${finding.line}` : finding.file;
      return "";
    }
    if (typeof loc === "string") return loc;
    return loc.line ? `${loc.file}:${loc.line}` : loc.file;
  });
</script>

<div class="finding {severity}">
  <div class="finding-head">
    <span class="finding-severity">{severity}</span>
    {#if finding.confidence}
      <span class="finding-tag">CONF: {finding.confidence}</span>
    {/if}
    {#if typeof finding.impact === "string" && finding.impact.length <= 20}
      <span class="finding-tag">IMPACT: {finding.impact}</span>
    {/if}
    {#if location}
      <span class="finding-location">{location}</span>
    {/if}
  </div>

  {#if finding.title}
    <div class="finding-title">{finding.title}</div>
  {/if}

  {#if finding.description}
    <div class="finding-desc">{finding.description}</div>
  {/if}

  {#if typeof finding.impact === "string" && finding.impact.length > 20}
    <div class="finding-impact">Impact: {finding.impact}</div>
  {/if}

  {#if finding.resolution}
    <div class="finding-resolved">✓ {finding.resolution}</div>
  {/if}

  {#if finding.recommendation}
    <div class="finding-suggestion">→ {finding.recommendation}</div>
  {/if}
  {#if finding.suggestion}
    <div class="finding-suggestion">→ {finding.suggestion}</div>
  {/if}

  {#if finding.evidence}
    <div class="finding-evidence">{finding.evidence}</div>
  {/if}

  {#if finding.discrepancy}
    <div class="finding-discrepancy">{finding.discrepancy}</div>
  {/if}

  {#if finding.tags?.length}
    <div class="finding-tags">
      {#each finding.tags as tag}
        <span class="tag">{tag}</span>
      {/each}
    </div>
  {/if}
</div>

<style>
  .finding {
    padding: 8px 10px;
    background: var(--bg);
    margin-bottom: 4px;
    border-left: 2px solid var(--text-dim);
    font-size: 10px;
  }
  .finding.critical { border-left-color: var(--red-dim); }
  .finding.high { border-left-color: var(--red-dim); }
  .finding.medium { border-left-color: var(--amber-dim); }
  .finding.low { border-left-color: var(--text-dim); }

  .finding-head {
    display: flex; gap: 6px; align-items: center;
    margin-bottom: 4px; flex-wrap: wrap;
  }

  .finding-severity {
    font-size: 8px; text-transform: uppercase;
    letter-spacing: 1px; padding: 1px 4px;
    border: 1px solid currentColor;
  }
  .finding.critical .finding-severity { color: var(--red-dim); }
  .finding.high .finding-severity { color: var(--red-dim); }
  .finding.medium .finding-severity { color: var(--amber-dim); }

  .finding-tag {
    font-size: 8px; color: var(--text-dim);
    border: 1px solid var(--border); padding: 1px 4px;
    letter-spacing: 1px;
  }

  .finding-location {
    font-size: 9px; color: var(--cyan-dim);
    margin-left: auto;
  }

  .finding-title {
    font-size: 11px; color: var(--text-bright);
    margin-bottom: 3px; font-weight: 500;
  }

  .finding-desc { color: var(--text); margin-bottom: 3px; }
  .finding-impact { color: var(--amber-dim); margin-bottom: 3px; font-size: 9px; }
  .finding-resolved { color: var(--green-dim); margin-bottom: 3px; }
  .finding-suggestion { color: var(--text); margin-bottom: 3px; font-style: italic; }
  .finding-evidence {
    background: var(--bg-card); padding: 4px 6px;
    border-left: 1px solid var(--border);
    color: var(--text-dim); margin-top: 4px;
    font-family: 'JetBrains Mono', monospace; font-size: 9px;
    white-space: pre-wrap;
  }
  .finding-discrepancy { color: var(--red-dim); margin-top: 3px; }

  .finding-tags { margin-top: 3px; display: flex; gap: 2px; flex-wrap: wrap; }
  .tag {
    font-size: 8px; padding: 1px 4px;
    background: var(--bg); border: 1px solid var(--border);
    color: var(--text-dim);
  }
</style>
