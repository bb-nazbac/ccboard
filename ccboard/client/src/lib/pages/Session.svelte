<script lang="ts">
  import type { Session } from "../types/session";
  import type { ContextInfo } from "../types/session";
  import { getSessions, getContext } from "../services/api";
  import { formatTokens } from "../utils/time";
  import SupervisorPane from "../components/session/supervisor/SupervisorPane.svelte";
  import ActionsPane from "../components/session/actions/ActionsPane.svelte";
  import ReviewsPane from "../components/session/reviews/ReviewsPane.svelte";
  import MessagesPane from "../components/session/messages/MessagesPane.svelte";

  let { pid }: { pid: number } = $props();
  let sessions = $state<Session[]>([]);
  let currentSession = $derived(sessions.find(s => s.pid === pid));
  let context = $state<ContextInfo | null>(null);

  const MAX_CONTEXT = 1_000_000;
  let contextPct = $derived(context ? Math.round((context.totalContextTokens / MAX_CONTEXT) * 100) : 0);

  let leftWidth = $state(300);
  let rightWidth = $state(400);
  let topPct = $state(50);

  $effect(() => { getSessions().then(s => { sessions = s; }); });
  $effect(() => {
    loadContext();
    const interval = setInterval(loadContext, 10000);
    return () => clearInterval(interval);
  });

  async function loadContext() { try { context = await getContext(pid); } catch {} }

  function handleKeydown(e: KeyboardEvent) {
    if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
    const idx = sessions.findIndex(s => s.pid === pid);
    if (e.shiftKey && e.key === "ArrowRight") { e.preventDefault(); const n = sessions[idx + 1]; if (n) window.location.href = `/session/${n.pid}`; }
    if (e.shiftKey && e.key === "ArrowLeft") { e.preventDefault(); const p = sessions[idx - 1]; if (p) window.location.href = `/session/${p.pid}`; }
  }

  function startResizeLeft(e: MouseEvent) {
    e.preventDefault(); const sx = e.clientX, sw = leftWidth;
    const move = (e: MouseEvent) => { leftWidth = Math.max(150, Math.min(600, sw + e.clientX - sx)); };
    const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); document.body.style.cursor = ""; document.body.style.userSelect = ""; };
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
    document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none";
  }
  function startResizeRight(e: MouseEvent) {
    e.preventDefault(); const sx = e.clientX, sw = rightWidth;
    const move = (e: MouseEvent) => { rightWidth = Math.max(150, Math.min(700, sw - (e.clientX - sx))); };
    const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); document.body.style.cursor = ""; document.body.style.userSelect = ""; };
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
    document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none";
  }
  function startResizeCenter(e: MouseEvent) {
    e.preventDefault(); const c = (e.target as HTMLElement).parentElement; if (!c) return;
    const sy = e.clientY, sp = topPct, ch = c.offsetHeight;
    const move = (e: MouseEvent) => { topPct = Math.max(15, Math.min(85, sp + ((e.clientY - sy) / ch) * 100)); };
    const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); document.body.style.cursor = ""; document.body.style.userSelect = ""; };
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
    document.body.style.cursor = "row-resize"; document.body.style.userSelect = "none";
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="session-page">
  <div class="session-bar">
    {#each sessions as s}
      <a class="tab" class:active={s.pid === pid} class:waiting={s.status === "waiting"} class:working={s.status === "working"} href="/session/{s.pid}">
        <span class="tab-name">{s.shortName}</span>
        <span class="tab-status">{s.status}</span>
      </a>
    {/each}
  </div>

  {#if context}
    <div class="ctx-row">
      <span class="ctx-stat">{formatTokens(context.totalContextTokens)} TOKENS</span>
      <span class="ctx-stat">{context.totalTurns} TURNS</span>
      <span class="ctx-stat">{context.totalToolCalls} TOOLS</span>
      <span class="ctx-stat">{context.totalMessages} MSGS</span>
      <span class="ctx-stat" class:ctx-warn={contextPct > 70} class:ctx-crit={contextPct > 90}>{contextPct}%</span>
    </div>
    <div class="token-bar"><div class="token-fill" style:width="{contextPct}%" class:warn={contextPct > 70} class:crit={contextPct > 90}></div></div>
  {/if}

  {#if currentSession}
    <div class="panes">
      <div class="pane" style:width="{leftWidth}px" style:flex-shrink="0">
        <SupervisorPane {pid} tmuxSession={currentSession.tmuxSession} />
      </div>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="resize-col" onmousedown={startResizeLeft}></div>
      <div class="pane" style:flex="1" style:min-width="0">
        <div style:flex="0 0 {topPct}%" style:display="flex" style:flex-direction="column" style:min-height="0" style:overflow="hidden">
          <ActionsPane {pid} />
        </div>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="resize-row" onmousedown={startResizeCenter}></div>
        <div style:flex="1" style:display="flex" style:flex-direction="column" style:min-height="0" style:overflow="hidden">
          <ReviewsPane {pid} />
        </div>
      </div>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="resize-col" onmousedown={startResizeRight}></div>
      <div class="pane" style:width="{rightWidth}px" style:flex-shrink="0">
        <MessagesPane {pid} />
      </div>
    </div>
  {:else}
    <div class="loading">LOADING SESSION {pid}...</div>
  {/if}
</div>

<style>
  .session-page { height: 100%; display: flex; flex-direction: column; }

  .session-bar {
    display: flex; gap: 0; padding: 0;
    background: var(--bg); flex-shrink: 0;
    border-bottom: 2px solid var(--border-neutral);
  }
  .tab {
    font-family: var(--font-heading); font-size: 12px; font-weight: 600;
    letter-spacing: 0.10em; text-transform: uppercase;
    color: var(--text-dim); padding: 8px 18px;
    border-bottom: 2px solid transparent;
    cursor: pointer; text-decoration: none;
    transition: all 0.15s; margin-bottom: -2px;
    display: flex; gap: 8px; align-items: baseline;
  }
  .tab:hover { color: var(--text-bright); }
  .tab.active { color: var(--orange); border-bottom-color: var(--orange); }
  .tab-name { }
  .tab-status { font-size: 8px; letter-spacing: 0.08em; opacity: 0.6; }

  .ctx-row {
    display: flex; gap: 1px; flex-shrink: 0;
    font-family: var(--font-data); font-size: 10px;
    letter-spacing: 0.06em;
  }
  .ctx-stat {
    flex: 1; text-align: center; padding: 4px 0;
    color: var(--text-dim); background: var(--bg-header);
  }
  .ctx-warn { color: var(--orange); }
  .ctx-crit { color: var(--red); }

  .token-bar { height: 3px; background: var(--border-neutral); flex-shrink: 0; }
  .token-fill {
    height: 100%; transition: width 0.4s;
    background: linear-gradient(90deg, var(--orange-dim), var(--orange));
    box-shadow: 0 0 8px var(--orange-glow);
  }
  .token-fill.warn { background: linear-gradient(90deg, var(--orange-dim), var(--orange)); }
  .token-fill.crit { background: linear-gradient(90deg, var(--red-dim), var(--red)); box-shadow: 0 0 8px rgba(217, 59, 59, 0.35); }

  .panes { flex: 1; display: flex; min-height: 0; overflow: hidden; }
  .pane {
    display: flex; flex-direction: column;
    background: var(--bg-panel); border: 1px solid var(--border-neutral);
    min-height: 0; overflow: hidden;
    position: relative;
  }
  /* Panel scanline texture */
  .pane::after {
    content: ''; position: absolute; inset: 0;
    background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.008) 2px, rgba(255,255,255,0.008) 4px);
    pointer-events: none; z-index: 1;
  }

  .resize-col {
    width: 4px; cursor: col-resize; flex-shrink: 0;
    background: var(--border-neutral); transition: background 0.15s;
  }
  .resize-col:hover { background: var(--orange-dim); box-shadow: 0 0 8px var(--orange-glow); }
  .resize-row {
    height: 4px; cursor: row-resize; flex-shrink: 0;
    background: var(--border-neutral); transition: background 0.15s;
  }
  .resize-row:hover { background: var(--orange-dim); box-shadow: 0 0 8px var(--orange-glow); }

  .loading {
    font-family: var(--font-heading); font-size: 14px;
    letter-spacing: 0.12em; color: var(--text-dim);
    padding: 60px; text-align: center;
  }
</style>
