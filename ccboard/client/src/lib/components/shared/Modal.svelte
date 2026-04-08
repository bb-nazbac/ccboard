<script lang="ts">
  import type { Snippet } from "svelte";

  let { open = false, onclose, children, title }: {
    open: boolean;
    onclose: () => void;
    children: Snippet;
    title?: string;
  } = $props();

  function handleOverlayClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onclose();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") onclose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-overlay" onclick={handleOverlayClick}>
    <div class="modal">
      <div class="modal-header">
        {#if title}
          <div class="modal-title">{title}</div>
        {/if}
        <button class="modal-close" onclick={onclose}>✕</button>
      </div>
      <div class="modal-body">
        {@render children()}
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed; inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 8000;
    display: flex; justify-content: center; align-items: flex-start;
    padding-top: 8vh;
  }

  :global([data-theme="light"]) .modal-overlay {
    background: rgba(0, 0, 0, 0.3);
  }

  .modal {
    width: 700px; max-width: 90vw; max-height: 80vh;
    background: var(--bg-card);
    border: 1px solid var(--border);
    display: flex; flex-direction: column;
  }

  .modal-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .modal-title {
    font-size: 11px; text-transform: uppercase;
    letter-spacing: 1px; color: var(--text-bright);
  }

  .modal-close {
    background: none; border: 1px solid var(--border);
    color: var(--text-dim); cursor: pointer;
    font-size: 10px; padding: 2px 8px;
    font-family: inherit;
  }
  .modal-close:hover { color: var(--text-bright); }

  .modal-body {
    flex: 1; overflow-y: auto; padding: 12px;
  }

  .modal-body::-webkit-scrollbar { width: 4px; }
  .modal-body::-webkit-scrollbar-track { background: transparent; }
  .modal-body::-webkit-scrollbar-thumb { background: var(--border); }
</style>
