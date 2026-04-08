<script lang="ts">
  import type { ReviewCategory, NormalisedReport } from "../../../types/reports";
  import { getReviews } from "../../../services/api";
  import { formatTime } from "../../../utils/time";
  import ReviewRow from "./ReviewRow.svelte";
  import ReviewModal from "./ReviewModal.svelte";

  let { pid }: { pid: number } = $props();

  let categories = $state<ReviewCategory[]>([]);
  let selectedReport = $state<NormalisedReport | null>(null);
  let modalOpen = $state(false);

  async function loadReviews() {
    try {
      const data = await getReviews(pid);
      categories = data.categories;
    } catch (err) {
      console.error("Failed to load reviews:", err);
    }
  }

  $effect(() => {
    loadReviews();
    const interval = setInterval(loadReviews, 15000);
    return () => clearInterval(interval);
  });

  let latestTimestamp = $derived.by(() => {
    const withTs = categories.filter(c => c.timestamp);
    if (withTs.length === 0) return "";
    const latest = withTs.reduce((a, b) => ((a.timestamp ?? "") > (b.timestamp ?? "") ? a : b));
    return latest.timestamp ? formatTime(latest.timestamp) : "";
  });

  function openReport(cat: ReviewCategory) {
    selectedReport = cat.report;
    modalOpen = true;
  }
</script>

<div class="pane-header">
  <span>Reviews</span>
  <span class="timestamp">{latestTimestamp}</span>
</div>
<div class="reviews-scroll">
  {#if categories.length === 0}
    <div class="empty">no reviews yet — ask the supervisor to run a review</div>
  {:else}
    {#each categories as cat}
      <ReviewRow category={cat} onclick={() => openReport(cat)} />
    {/each}
  {/if}
</div>

<ReviewModal report={selectedReport} open={modalOpen} onclose={() => { modalOpen = false; }} />

<style>
  .pane-header {
    padding: 6px 10px; font-size: 10px; text-transform: uppercase;
    letter-spacing: 1px; color: var(--text-dim);
    border-bottom: 1px solid var(--border); flex-shrink: 0;
    display: flex; justify-content: space-between; align-items: center;
  }

  .timestamp { font-size: 9px; color: var(--text-dim); text-transform: none; letter-spacing: 0; }

  .reviews-scroll {
    flex: 1; overflow-y: auto; min-height: 0;
    padding: 4px;
  }

  .empty { color: var(--text-dim); font-size: 11px; padding: 20px; text-align: center; }
</style>
