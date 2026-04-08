<script lang="ts">
  import type { ActionEvent as ActionEvt, ActionStreamEvent } from "../../../types/sse-events";
  import { getActions } from "../../../services/api";
  import { createSSE } from "../../../services/sse";
  import ActionEvent from "./ActionEvent.svelte";
  import ActionDetailModal from "./ActionDetailModal.svelte";
  import { onMount } from "svelte";

  let { pid }: { pid: number } = $props();

  let events = $state<ActionEvt[]>([]);
  let selectedEvent = $state<ActionEvt | null>(null);
  let modalOpen = $state(false);
  let scrollEl: HTMLDivElement | undefined = $state();

  // Dedup for SSE events
  const seen = new Set<string>();
  function eventKey(e: ActionEvt): string {
    return `${e.tool}:${e.timestamp ?? ""}:${e.detail?.slice(0, 30) ?? ""}`;
  }

  function scrollToBottom() {
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  }

  async function loadHistorical() {
    try {
      const turns = await getActions(pid);
      for (const turn of turns) {
        for (const a of turn.actions) {
          if (a.type === "tool_use" && a.tool) {
            const evt: ActionEvt = {
              type: "action",
              tool: a.tool,
              detail: a.text ?? a.command ?? a.filePath ?? a.pattern ?? "",
              timestamp: a.timestamp,
              filePath: a.filePath,
              command: a.command,
              description: a.description,
              oldString: a.oldString,
              newString: a.newString,
              pattern: a.pattern,
              path: a.path,
            };
            const key = eventKey(evt);
            if (!seen.has(key)) {
              seen.add(key);
              events.push(evt);
            }
          }
        }
      }
      events = [...events]; // trigger reactivity
      setTimeout(scrollToBottom, 50);
    } catch (err) {
      console.error("Failed to load actions:", err);
    }
  }

  const sse = createSSE<ActionStreamEvent>(
    `/api/sessions/${pid}/action-stream`,
    (data) => {
      if (data.type === "action") {
        const key = eventKey(data);
        if (!seen.has(key)) {
          seen.add(key);
          events = [...events, data];
          // Cap at 500 events
          if (events.length > 500) events = events.slice(-400);
          setTimeout(scrollToBottom, 50);
        }
      }
    }
  );

  function openDetail(evt: ActionEvt) {
    selectedEvent = evt;
    modalOpen = true;
  }

  onMount(() => {
    loadHistorical();
    sse.connect();
    return () => sse.disconnect();
  });
</script>

<div class="pane-header">
  <span>Live Actions</span>
  <span class="action-count">{events.length}</span>
</div>

<div class="actions-scroll" bind:this={scrollEl}>
  <div class="spacer"></div>
  {#if events.length === 0}
    <div class="empty">waiting for agent activity<span class="cursor"></span></div>
  {:else}
    {#each events as evt}
      <ActionEvent event={evt} onclick={() => openDetail(evt)} />
    {/each}
  {/if}
</div>

<ActionDetailModal event={selectedEvent} open={modalOpen} onclose={() => { modalOpen = false; }} />

<style>
  .pane-header {
    padding: 6px 10px; font-size: 10px; text-transform: uppercase;
    letter-spacing: 1px; color: var(--text-dim);
    border-bottom: 1px solid var(--border); flex-shrink: 0;
    display: flex; justify-content: space-between; align-items: center;
  }
  .action-count { font-size: 9px; color: var(--text-dim); text-transform: none; }

  .actions-scroll {
    flex: 1; overflow-y: auto; min-height: 0;
    font-size: 11px; display: flex; flex-direction: column;
  }
  .spacer { flex: 1; }

  .empty { color: var(--text-dim); font-size: 11px; padding: 20px; text-align: center; }
  .cursor { animation: blink 1s step-end infinite; }
  @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
</style>
