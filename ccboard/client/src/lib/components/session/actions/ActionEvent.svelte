<script lang="ts">
  import type { ActionEvent as ActionEvt } from "../../../types/sse-events";
  import { formatTime } from "../../../utils/time";
  import { shortenPath } from "../../../utils/html";

  let { event, onclick }: { event: ActionEvt; onclick: () => void } = $props();

  let detail = $derived.by(() => {
    const tool = event.tool;
    if (tool === "Bash" && event.command) return event.command.slice(0, 80);
    if (tool === "Read" && event.filePath) return shortenPath(event.filePath);
    if (tool === "Write" && event.filePath) return shortenPath(event.filePath);
    if (tool === "Edit" && event.filePath) return shortenPath(event.filePath);
    if (tool === "Glob" && event.pattern) return event.pattern;
    if (tool === "Grep" && event.pattern) return `${event.pattern} ${event.path ? "in " + shortenPath(event.path) : ""}`;
    if (tool === "Agent" && event.description) return event.description;
    return event.detail?.slice(0, 80) ?? "";
  });

  const TOOL_COLORS: Record<string, string> = {
    Bash: "var(--amber)",
    Read: "var(--cyan-dim)",
    Write: "var(--green)",
    Edit: "var(--green-dim)",
    Glob: "var(--text)",
    Grep: "var(--text)",
    Agent: "var(--cyan)",
  };

  let toolColor = $derived(TOOL_COLORS[event.tool] ?? "var(--text-dim)");
</script>

<button class="action-event" {onclick}>
  {#if event.timestamp}
    <span class="action-time">{formatTime(event.timestamp)}</span>
  {/if}
  <span class="action-tool" style:color={toolColor}>{event.tool}</span>
  <span class="action-detail">{detail}</span>
</button>

<style>
  .action-event {
    display: flex; gap: 8px; align-items: baseline;
    padding: 3px 8px; cursor: pointer;
    background: none; border: none;
    font-family: inherit; font-size: 10px;
    color: var(--text); text-align: left;
    width: 100%;
  }
  .action-event:hover { background: var(--bg-card-hover); }

  .action-time { font-size: 9px; color: var(--text-dim); flex-shrink: 0; min-width: 55px; }
  .action-tool {
    font-size: 9px; font-weight: 500;
    min-width: 40px; flex-shrink: 0;
  }
  .action-detail {
    color: var(--text-dim); white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis; flex: 1;
  }
</style>
