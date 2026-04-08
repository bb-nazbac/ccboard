<script lang="ts">
  import type { ActionEvent } from "../../../types/sse-events";
  import Modal from "../../shared/Modal.svelte";

  let { event, open = false, onclose }: {
    event: ActionEvent | null;
    open: boolean;
    onclose: () => void;
  } = $props();
</script>

<Modal {open} {onclose} title={event?.tool ?? "Action"}>
  {#if event}
    <div class="detail-grid">
      <div class="detail-row">
        <span class="detail-label">Tool</span>
        <span class="detail-value tool">{event.tool}</span>
      </div>
      {#if event.timestamp}
        <div class="detail-row">
          <span class="detail-label">Time</span>
          <span class="detail-value">{event.timestamp}</span>
        </div>
      {/if}
      {#if event.description}
        <div class="detail-row">
          <span class="detail-label">Description</span>
          <span class="detail-value">{event.description}</span>
        </div>
      {/if}
      {#if event.filePath}
        <div class="detail-row">
          <span class="detail-label">File</span>
          <span class="detail-value path">{event.filePath}</span>
        </div>
      {/if}
      {#if event.command}
        <div class="detail-row">
          <span class="detail-label">Command</span>
          <pre class="detail-code">{event.command}</pre>
        </div>
      {/if}
      {#if event.pattern}
        <div class="detail-row">
          <span class="detail-label">Pattern</span>
          <span class="detail-value">{event.pattern}</span>
        </div>
      {/if}
      {#if event.path}
        <div class="detail-row">
          <span class="detail-label">Path</span>
          <span class="detail-value path">{event.path}</span>
        </div>
      {/if}
    </div>

    {#if event.oldString || event.newString}
      <div class="diff-section">
        {#if event.oldString}
          <div class="diff-block removed">
            <div class="diff-label">- Removed</div>
            <pre>{event.oldString}</pre>
          </div>
        {/if}
        {#if event.newString}
          <div class="diff-block added">
            <div class="diff-label">+ Added</div>
            <pre>{event.newString}</pre>
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</Modal>

<style>
  .detail-grid { display: flex; flex-direction: column; gap: 6px; }

  .detail-row { display: flex; gap: 12px; font-size: 10px; }
  .detail-label {
    color: var(--text-dim); min-width: 80px; flex-shrink: 0;
    text-transform: uppercase; font-size: 9px; letter-spacing: 1px;
    padding-top: 2px;
  }
  .detail-value { color: var(--text-bright); word-break: break-all; }
  .detail-value.tool { color: var(--green); font-weight: 500; }
  .detail-value.path { color: var(--cyan-dim); font-family: 'JetBrains Mono', monospace; font-size: 10px; }

  .detail-code {
    background: var(--bg); padding: 6px 8px;
    border: 1px solid var(--border);
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px; color: var(--amber);
    white-space: pre-wrap; margin: 0;
    overflow-x: auto;
  }

  .diff-section { margin-top: 12px; }
  .diff-block {
    margin-bottom: 8px;
  }
  .diff-block pre {
    background: var(--bg); padding: 6px 8px;
    border: 1px solid var(--border);
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px; white-space: pre-wrap;
    margin: 0; overflow-x: auto;
  }
  .diff-label {
    font-size: 9px; padding: 2px 6px;
    margin-bottom: 2px;
  }
  .diff-block.removed .diff-label { color: var(--red-dim); }
  .diff-block.removed pre { border-left: 2px solid var(--red-dim); }
  .diff-block.added .diff-label { color: var(--green-dim); }
  .diff-block.added pre { border-left: 2px solid var(--green-dim); }
</style>
