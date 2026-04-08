<script lang="ts">
  let { status }: { status: string } = $props();
</script>

<span class="badge {status}">{status}</span>

<style>
  .badge {
    font-size: 8px; text-transform: uppercase;
    letter-spacing: 1px; padding: 1px 6px;
    border: 1px solid var(--border);
    color: var(--text-dim);
  }
  .badge.waiting { color: var(--amber); border-color: var(--amber-dim); }
  .badge.working { color: var(--cyan); border-color: var(--cyan-dim); }
  .badge.idle { color: var(--text-dim); }
  .badge.dead { color: var(--red-dim); border-color: var(--red-dim); }
  .badge.ok { color: var(--green); border-color: var(--green-dim); }
  .badge.warning { color: var(--amber); border-color: var(--amber-dim); }
  .badge.issue { color: var(--amber); border-color: var(--amber-dim); }
  .badge.critical { color: var(--red); border-color: var(--red-dim); }
</style>
