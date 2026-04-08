<script lang="ts">
  import { toggleTheme } from "../../stores/theme.svelte";

  interface Command {
    id: string;
    label: string;
    keywords: string;
    action: () => void;
  }

  const COMMANDS: Command[] = [
    { id: "theme-toggle", label: "Toggle theme (dark/light)", keywords: "theme dark light mode", action: toggleTheme },
    { id: "theme-dark", label: "Switch to dark theme", keywords: "theme dark", action: () => applyDark() },
    { id: "theme-light", label: "Switch to light theme", keywords: "theme light", action: () => applyLight() },
    { id: "go-dashboard", label: "Go to dashboard", keywords: "home dashboard sessions", action: () => { window.location.href = "/"; } },
  ];

  function applyDark() {
    document.documentElement.setAttribute("data-theme", "dark");
    document.body.classList.remove("no-crt");
    localStorage.setItem("ccboard-theme", "dark");
  }
  function applyLight() {
    document.documentElement.setAttribute("data-theme", "light");
    document.body.classList.add("no-crt");
    localStorage.setItem("ccboard-theme", "light");
  }

  let open = $state(false);
  let query = $state("");
  let selectedIdx = $state(0);
  let inputEl: HTMLInputElement | undefined = $state();

  let filtered = $derived(
    query.trim()
      ? COMMANDS.filter(c => c.label.toLowerCase().includes(query.toLowerCase()) || c.keywords.includes(query.toLowerCase()))
      : COMMANDS
  );

  function toggle() {
    open = !open;
    if (open) {
      query = "";
      selectedIdx = 0;
      // Focus input after DOM update
      setTimeout(() => inputEl?.focus(), 10);
    }
  }

  function execute(idx: number) {
    const cmd = filtered[idx];
    if (!cmd) return;
    open = false;
    setTimeout(() => cmd.action(), 50);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") { open = false; e.preventDefault(); return; }
    if (e.key === "ArrowDown") { selectedIdx = Math.min(selectedIdx + 1, filtered.length - 1); e.preventDefault(); return; }
    if (e.key === "ArrowUp") { selectedIdx = Math.max(selectedIdx - 1, 0); e.preventDefault(); return; }
    if (e.key === "Enter") { execute(selectedIdx); e.preventDefault(); return; }
  }

  function handleGlobalKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "p" || e.key === "P")) {
      e.preventDefault();
      toggle();
    }
  }
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="overlay" onclick={(e) => { if (e.target === e.currentTarget) open = false; }}>
    <div class="palette">
      <input
        bind:this={inputEl}
        class="palette-input"
        type="text"
        placeholder="Type a command..."
        autocomplete="off"
        spellcheck="false"
        bind:value={query}
        onkeydown={handleKeydown}
      />
      <div class="palette-results">
        {#each filtered as cmd, i}
          <button
            class="palette-item"
            class:selected={i === selectedIdx}
            onmousedown={(e) => { e.preventDefault(); execute(i); }}
            onmouseenter={() => { selectedIdx = i; }}
          >
            {cmd.label}
          </button>
        {/each}
        {#if filtered.length === 0}
          <div class="palette-empty">no matching commands</div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed; inset: 0;
    background: var(--bg-overlay);
    z-index: 9000;
    display: flex; justify-content: center; align-items: flex-start;
    padding-top: 15vh;
    backdrop-filter: blur(4px);
  }

  .palette {
    width: 480px; max-width: 90vw;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-left: 3px solid var(--orange);
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.6), 0 0 30px var(--orange-glow);
    overflow: hidden;
  }

  .palette-input {
    width: 100%;
    background: rgba(10, 10, 10, 0.80);
    border: none; border-bottom: 1px solid var(--border);
    color: var(--text-bright);
    font-family: var(--font-body); font-size: 14px;
    padding: 14px 16px; outline: none;
    letter-spacing: 0.02em;
  }
  .palette-input::placeholder { color: var(--text-dim); }

  .palette-results { max-height: 300px; overflow-y: auto; }

  .palette-item {
    display: block; width: 100%;
    padding: 10px 16px;
    font-family: var(--font-heading); font-size: 13px; font-weight: 500;
    letter-spacing: 0.04em;
    color: var(--text); cursor: pointer;
    background: none; border: none; border-left: 2px solid transparent;
    text-align: left; transition: all 0.1s;
  }
  .palette-item:hover, .palette-item.selected {
    background: var(--bg-panel-hover);
    color: var(--text-bright);
    border-left-color: var(--orange);
  }

  .palette-empty {
    padding: 16px; font-family: var(--font-heading);
    font-size: 12px; color: var(--text-dim);
    text-align: center; letter-spacing: 0.08em;
  }
</style>
