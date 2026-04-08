<script lang="ts">
  import type { ReviewCategory } from "../../../types/reports";

  let { category, onclick }: { category: ReviewCategory; onclick: () => void } = $props();

  const ICONS: Record<string, string> = {
    ok: "✓", warning: "⚠", issue: "⚠", critical: "✗",
  };

  let icon = $derived(category.isVerdict ? "⚖" : (ICONS[category.status] ?? "?"));
  let label = $derived(category.category.toUpperCase().replace(/-/g, " "));
</script>

<button class="review-row {category.status}" class:verdict={category.isVerdict} {onclick}>
  <span class="review-icon {category.status}">{icon}</span>
  <span class="review-label">{label}</span>
  <span class="review-detail">
    {category.summary}
    {#if category.findingCount > 0}
      ({category.findingCount})
    {/if}
  </span>
</button>

<style>
  .review-row {
    display: flex; gap: 8px; align-items: baseline;
    padding: 6px 8px; cursor: pointer;
    background: var(--bg); border: none;
    font-family: inherit; font-size: inherit;
    color: var(--text); text-align: left;
    width: 100%; margin-bottom: 2px;
    transition: background 0.1s;
  }
  .review-row:hover { background: var(--bg-card-hover); }

  .review-row.verdict {
    background: var(--cyan-faint);
    border-left: 2px solid var(--cyan-dim);
  }

  .review-icon { font-size: 12px; flex-shrink: 0; }
  .review-icon.ok { color: var(--green); }
  .review-icon.warning { color: var(--amber); }
  .review-icon.issue { color: var(--amber); }
  .review-icon.critical { color: var(--red); }

  .review-label {
    font-size: 9px; letter-spacing: 1px;
    color: var(--text-bright); min-width: 80px;
    flex-shrink: 0;
  }

  .review-detail {
    font-size: 10px; color: var(--text-dim);
    white-space: nowrap; overflow: hidden;
    text-overflow: ellipsis; flex: 1;
  }
</style>
