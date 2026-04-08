<script lang="ts">
  import type { ChatMessage } from "../../../types/api";
  import { renderMarkdown } from "../../../utils/markdown";
  import { formatTime } from "../../../utils/time";

  let { message }: { message: ChatMessage } = $props();

  let html = $derived(
    message.role === "assistant" ? renderMarkdown(message.text) : message.text
  );
</script>

<div class="message {message.role}">
  <div class="message-header">
    <span class="message-role">{message.role === "human" ? "YOU" : "ASSISTANT"}</span>
    {#if message.timestamp}
      <span class="message-time">{formatTime(message.timestamp)}</span>
    {/if}
  </div>
  <div class="message-text">
    {#if message.role === "assistant"}
      {@html html}
    {:else}
      <pre class="human-text">{message.text}</pre>
    {/if}
  </div>
</div>

<style>
  .message {
    padding: 8px 10px;
    margin-bottom: 4px;
    border-left: 2px solid var(--border);
    font-size: 11px;
  }

  .message.human {
    background: var(--amber-faint);
    border-left-color: var(--amber-dim);
  }
  .message.assistant {
    background: var(--bg-card);
    border-left-color: var(--green-dim);
  }

  .message-header {
    display: flex; justify-content: space-between;
    margin-bottom: 4px;
  }
  .message-role {
    font-size: 8px; text-transform: uppercase;
    letter-spacing: 1px; color: var(--text-dim);
  }
  .message-time { font-size: 8px; color: var(--text-dim); }

  .human-text {
    white-space: pre-wrap; font-family: inherit;
    font-size: 11px; color: var(--text-bright);
    margin: 0; background: none; border: none;
  }

  .message-text { color: var(--text); line-height: 1.5; }
  .message-text :global(p) { margin-bottom: 6px; }
  .message-text :global(pre) {
    background: var(--bg); padding: 8px;
    overflow-x: auto; margin: 6px 0;
    border: 1px solid var(--border);
  }
  .message-text :global(code) {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
  }
  .message-text :global(p code) {
    background: var(--bg); padding: 1px 4px;
    border: 1px solid var(--border);
    color: var(--amber);
  }
  .message-text :global(table) {
    width: 100%; border-collapse: collapse;
    margin: 6px 0; font-size: 10px;
  }
  .message-text :global(th),
  .message-text :global(td) {
    border: 1px solid var(--border);
    padding: 4px 8px; text-align: left;
  }
  .message-text :global(th) {
    background: var(--bg); color: var(--text-bright);
  }
  .message-text :global(blockquote) {
    border-left: 2px solid var(--green-dim);
    padding-left: 8px; margin: 6px 0;
    color: var(--text);
  }
  .message-text :global(ul), .message-text :global(ol) {
    padding-left: 20px; margin: 4px 0;
  }
  .message-text :global(strong) { color: var(--text-bright); }
</style>
