<script lang="ts">
  import type { ChatMessage as ChatMsg } from "../../../types/api";
  import type { AgentMessageEvent, PaneEvent } from "../../../types/sse-events";
  import { getMessages, sendMessage } from "../../../services/api";
  import { createSSE } from "../../../services/sse";
  import ChatMessage from "./ChatMessage.svelte";
  import { onMount } from "svelte";

  let { pid }: { pid: number } = $props();

  let messages = $state<ChatMsg[]>([]);
  let inputText = $state("");
  let scrollEl: HTMLDivElement | undefined = $state();
  let isWaiting = $state(true);
  let liveText = $state("");
  let sending = $state(false);

  // Dedup map to avoid double-appending from SSE + initial load
  const seen = new Set<string>();

  function msgKey(m: ChatMsg): string {
    return `${m.role}:${m.timestamp ?? ""}:${m.text.slice(0, 50)}`;
  }

  function scrollToBottom() {
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  }

  async function loadMessages() {
    try {
      const msgs = await getMessages(pid);
      for (const m of msgs) seen.add(msgKey(m));
      messages = msgs;
      setTimeout(scrollToBottom, 50);
    } catch (err) {
      console.error("Failed to load messages:", err);
    }
  }

  // SSE for real-time messages
  const agentSSE = createSSE<AgentMessageEvent | { type: "connected" }>(
    `/api/sessions/${pid}/stream`,
    (data) => {
      if (data.type === "message") {
        const key = msgKey(data);
        if (!seen.has(key)) {
          seen.add(key);
          messages = [...messages, data];
          setTimeout(scrollToBottom, 50);
        }
      }
    }
  );

  // SSE for pane status (working text, interactive prompts)
  const paneSSE = createSSE<PaneEvent | { type: "connected" }>(
    `/api/sessions/${pid}/pane-stream`,
    (data) => {
      if (data.type === "pane") {
        isWaiting = data.status === "waiting";
        liveText = data.workingText ?? "";
      }
    }
  );

  async function send() {
    const text = inputText.trim();
    if (!text || sending) return;
    sending = true;
    inputText = "";
    try {
      await sendMessage(pid, text);
    } catch (err) {
      console.error("Failed to send:", err);
    } finally {
      sending = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  onMount(() => {
    loadMessages();
    agentSSE.connect();
    paneSSE.connect();
    return () => {
      agentSSE.disconnect();
      paneSSE.disconnect();
    };
  });
</script>

<div class="pane-header">
  <span>Agent Chat</span>
  <span class="status" class:waiting={isWaiting} class:working={!isWaiting}>
    {isWaiting ? "ready" : "thinking..."}
  </span>
</div>

<div class="messages-scroll" bind:this={scrollEl}>
  <div class="spacer"></div>
  {#each messages as msg}
    <ChatMessage message={msg} />
  {/each}
  {#if liveText}
    <div class="live-output">{liveText}</div>
  {/if}
</div>

<div class="send-area">
  <input
    class="send-input"
    type="text"
    placeholder={isWaiting ? "Talk to agent..." : "Agent is thinking..."}
    disabled={!isWaiting || sending}
    bind:value={inputText}
    onkeydown={handleKeydown}
  />
  <button class="send-btn" disabled={!isWaiting || sending} onclick={send}>▶</button>
</div>

<style>
  .pane-header {
    padding: 6px 10px; font-size: 10px; text-transform: uppercase;
    letter-spacing: 1px; color: var(--text-dim);
    border-bottom: 1px solid var(--border); flex-shrink: 0;
    display: flex; justify-content: space-between; align-items: center;
  }

  .status { font-size: 9px; text-transform: none; letter-spacing: 0; }
  .status.waiting { color: var(--amber); }
  .status.working { color: var(--cyan); }

  .messages-scroll {
    flex: 1; overflow-y: auto; min-height: 0;
    display: flex; flex-direction: column;
  }
  .spacer { flex: 1; }

  .live-output {
    padding: 8px 10px; font-size: 10px;
    color: var(--cyan-dim); white-space: pre-wrap;
    border-left: 2px solid var(--cyan-faint);
    animation: pulse 1.5s ease-in-out infinite;
  }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }

  .send-area {
    display: flex; gap: 4px; padding: 6px;
    border-top: 1px solid var(--border); flex-shrink: 0;
  }

  .send-input {
    flex: 1; background: var(--bg); border: 1px solid var(--border);
    color: var(--text-bright); font-family: inherit; font-size: 11px;
    padding: 6px 8px; outline: none;
  }
  .send-input:focus { border-color: var(--green-dim); }
  .send-input:disabled { opacity: 0.5; }
  .send-input::placeholder { color: var(--text-dim); }

  .send-btn {
    background: none; border: 1px solid var(--green-dim);
    color: var(--green); cursor: pointer; padding: 4px 10px;
    font-family: inherit; font-size: 11px;
  }
  .send-btn:hover:not(:disabled) { background: var(--green-faint); }
  .send-btn:disabled { opacity: 0.3; cursor: default; }
</style>
