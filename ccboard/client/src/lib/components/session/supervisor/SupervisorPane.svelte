<script lang="ts">
  import type { ChatMessage } from "../../../types/api";
  import type { SupervisorStreamEvent } from "../../../types/sse-events";
  import { getSupervisorMessages, sendSupervisorMessage, startSupervisor } from "../../../services/api";
  import { createSSE } from "../../../services/sse";
  import ChatMsg from "../messages/ChatMessage.svelte";
  import { onMount } from "svelte";

  let { pid, tmuxSession = null }: { pid: number; tmuxSession?: string | null } = $props();

  let tmuxCopied = $state(false);
  function copyTmux() {
    if (!tmuxSession) return;
    navigator.clipboard.writeText(`tmux attach -t ${tmuxSession}`);
    tmuxCopied = true;
    setTimeout(() => { tmuxCopied = false; }, 1500);
  }

  let messages = $state<ChatMessage[]>([]);
  let inputText = $state("");
  let scrollEl: HTMLDivElement | undefined = $state();
  let isWaiting = $state(true);
  let sending = $state(false);
  let supActive = $state(false);

  const seen = new Set<string>();
  function msgKey(m: ChatMessage): string {
    return `${m.role}:${m.timestamp ?? ""}:${m.text.slice(0, 50)}`;
  }

  function scrollToBottom() {
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  }

  async function loadMessages() {
    try {
      const msgs = await getSupervisorMessages(pid, 50);
      for (const m of msgs) seen.add(msgKey(m));
      messages = msgs;
      supActive = true;
      setTimeout(scrollToBottom, 50);

      // Backfill full history
      const full = await getSupervisorMessages(pid);
      for (const m of full) seen.add(msgKey(m));
      messages = full;
    } catch {
      supActive = false;
    }
  }

  const sse = createSSE<SupervisorStreamEvent>(
    `/api/sessions/${pid}/supervisor/stream`,
    (data) => {
      if (data.type === "message") {
        const key = msgKey(data);
        if (!seen.has(key)) {
          seen.add(key);
          messages = [...messages, data];
          setTimeout(scrollToBottom, 50);
        }
      }
      if (data.type === "status") {
        isWaiting = data.isWaiting;
      }
    }
  );

  async function send() {
    const text = inputText.trim();
    if (!text || sending) return;
    sending = true;
    inputText = "";
    try {
      await sendSupervisorMessage(pid, text);
    } catch (err) {
      console.error("Failed to send to supervisor:", err);
    } finally {
      sending = false;
    }
  }

  async function handleStart() {
    try {
      await startSupervisor(pid);
      supActive = true;
      loadMessages();
    } catch (err) {
      console.error("Failed to start supervisor:", err);
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
    sse.connect();
    return () => sse.disconnect();
  });
</script>

<div class="pane-header">
  <span>Supervisor</span>
  <span class="status" class:waiting={isWaiting} class:working={!isWaiting}>
    {supActive ? (isWaiting ? "ready" : "thinking...") : "inactive"}
  </span>
</div>
{#if tmuxSession}
  <button class="tmux-cmd" onclick={copyTmux}>
    {tmuxCopied ? "copied!" : `tmux attach -t ${tmuxSession}`}
  </button>
{/if}

<div class="sup-scroll" bind:this={scrollEl}>
  <div class="spacer"></div>
  {#if !supActive}
    <div class="empty">
      <div>no supervisor session</div>
      <button class="start-btn" onclick={handleStart}>START SUPERVISOR</button>
    </div>
  {:else if messages.length === 0}
    <div class="empty">supervisor connected — no messages yet</div>
  {:else}
    {#each messages as msg}
      <ChatMsg message={msg} />
    {/each}
  {/if}
</div>

<div class="send-area">
  <input
    class="send-input"
    type="text"
    placeholder={isWaiting ? "Talk to supervisor..." : "Supervisor is thinking..."}
    disabled={!isWaiting || !supActive || sending}
    bind:value={inputText}
    onkeydown={handleKeydown}
  />
  <button class="send-btn" disabled={!isWaiting || !supActive || sending} onclick={send}>▶</button>
</div>

<style>
  .pane-header {
    padding: 8px 12px; flex-shrink: 0;
    font-family: var(--font-heading); font-size: 12px; font-weight: 700;
    letter-spacing: 0.12em; text-transform: uppercase;
    color: var(--orange);
    border-bottom: 1px solid var(--border);
    display: flex; justify-content: space-between; align-items: center;
  }

  .status {
    font-family: var(--font-data); font-size: 10px; font-weight: 400;
    letter-spacing: 0.06em; text-transform: uppercase;
  }
  .status.waiting { color: var(--orange); }
  .status.working { color: var(--blue); }

  .tmux-cmd {
    display: block; width: 100%; padding: 4px 12px;
    font-size: 9px; font-family: var(--font-mono);
    color: var(--text-dim); background: var(--bg);
    border: none; border-bottom: 1px solid var(--border-neutral);
    cursor: pointer; text-align: left; letter-spacing: 0.04em;
  }
  .tmux-cmd:hover { color: var(--orange); background: var(--bg-panel-hover); }

  .sup-scroll { flex: 1; overflow-y: auto; min-height: 0; display: flex; flex-direction: column; }
  .spacer { flex: 1; }

  .empty {
    font-family: var(--font-heading); font-size: 12px;
    letter-spacing: 0.08em; color: var(--text-dim);
    padding: 30px; text-align: center;
  }

  .start-btn {
    margin-top: 10px;
    font-family: var(--font-heading); font-size: 12px; font-weight: 700;
    letter-spacing: 0.10em; text-transform: uppercase;
    color: var(--text-bright); background: var(--orange-faint);
    border: 1px solid var(--border); padding: 8px 24px;
    cursor: pointer; transition: all 0.15s;
  }
  .start-btn:hover {
    background: rgba(245, 124, 37, 0.25);
    border-color: var(--orange); color: var(--text-white);
    box-shadow: 0 0 20px var(--orange-glow);
  }

  .send-area {
    display: flex; gap: 4px; padding: 6px;
    border-top: 1px solid var(--border); flex-shrink: 0;
  }
  .send-input {
    flex: 1; background: rgba(10, 10, 10, 0.80);
    border: 1px solid var(--border-neutral);
    color: var(--text-bright); font-family: var(--font-body);
    font-size: 12px; padding: 8px 10px; outline: none;
    transition: all 0.15s; letter-spacing: 0.02em;
  }
  .send-input:focus { border-color: var(--border-bright); box-shadow: 0 0 12px rgba(245, 124, 37, 0.08); }
  .send-input:disabled { opacity: 0.4; }
  .send-input::placeholder { color: var(--text-dim); }
  .send-btn {
    font-family: var(--font-heading); font-size: 12px; font-weight: 700;
    background: var(--orange-faint); border: 1px solid var(--border);
    color: var(--orange); cursor: pointer; padding: 6px 14px;
    letter-spacing: 0.08em; transition: all 0.15s;
  }
  .send-btn:hover:not(:disabled) { background: rgba(245, 124, 37, 0.25); border-color: var(--orange); box-shadow: 0 0 15px var(--orange-glow); }
  .send-btn:disabled { opacity: 0.3; cursor: default; }
</style>
