<script lang="ts">
  import { getSessions } from "../services/api";
  import type { Session } from "../types/session";
  import { timeAgo } from "../utils/time";
  import { navigateTo } from "../utils/navigate";

  let sessions = $state<Session[]>([]);
  let loading = $state(true);

  async function loadSessions() {
    try {
      sessions = await getSessions();
    } catch (err) {
      console.error("Failed to load sessions:", err);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    loadSessions();
    const interval = setInterval(loadSessions, 3000);
    return () => clearInterval(interval);
  });
</script>

<div class="dashboard">
  <header class="header">
    <div class="logo">
      <span class="logo-icon">&#x2B22;</span>
      <span class="logo-text">CCBOARD</span>
      <span class="logo-ver">v1.0</span>
    </div>
    <div class="header-right">
      <span class="live-dot"></span>
      <span class="session-count">{sessions.length} ACTIVE</span>
    </div>
  </header>

  <div class="summary-bar">
    {#each ["waiting", "working", "idle", "dead"] as status}
      {@const count = sessions.filter(s => s.status === status).length}
      {#if count > 0}
        <span class="summary-item {status}">
          <span class="summary-count">{count}</span>
          <span class="summary-label">{status}</span>
        </span>
      {/if}
    {/each}
  </div>

  <div class="divider"></div>

  <div class="sessions">
    {#if loading}
      <div class="empty">SCANNING FOR SESSIONS<span class="cursor">_</span></div>
    {:else if sessions.length === 0}
      <div class="empty">NO ACTIVE SESSIONS DETECTED</div>
    {:else}
      {#each sessions as session}
        <a class="session {session.status}" href="/session/{session.pid}">
          <div class="session-accent"></div>
          <div class="session-body">
            <div class="session-top">
              <span class="session-name">{session.shortName}</span>
              <span class="session-status {session.status}">{session.status}</span>
            </div>
            <div class="session-path">{session.cwd}</div>
            {#if session.snippet}
              <div class="session-snippet">{session.snippet}</div>
            {/if}
            <div class="session-meta">
              <span>PID {session.pid}</span>
              <span>{timeAgo(session.lastActivity)}</span>
              {#if session.managed}
                <span class="managed-badge">MANAGED</span>
              {/if}
            </div>
          </div>
        </a>
      {/each}
    {/if}
  </div>
</div>

<style>
  .dashboard {
    height: 100%; display: flex; flex-direction: column;
    max-width: 900px; margin: 0 auto; padding: 24px 20px;
  }

  .header {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 16px;
  }
  .logo { display: flex; align-items: baseline; gap: 8px; }
  .logo-icon { font-size: 16px; color: var(--orange); }
  .logo-text {
    font-family: var(--font-heading); font-size: 22px; font-weight: 700;
    letter-spacing: 0.15em; color: var(--text-bright);
  }
  .logo-ver { font-size: 10px; color: var(--text-dim); letter-spacing: 0.08em; }

  .header-right {
    display: flex; align-items: center; gap: 8px;
    font-family: var(--font-heading); font-size: 12px;
    letter-spacing: 0.10em; color: var(--text-dim);
  }
  .live-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--orange);
    box-shadow: 0 0 8px var(--orange-glow);
    animation: pulse 2s infinite;
  }
  .session-count { color: var(--orange); }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

  .summary-bar {
    display: flex; gap: 20px; margin-bottom: 12px;
    font-family: var(--font-heading);
  }
  .summary-item { display: flex; align-items: baseline; gap: 4px; }
  .summary-count { font-size: 20px; font-weight: 700; color: var(--text-dim); }
  .summary-item.waiting .summary-count { color: var(--orange); }
  .summary-item.working .summary-count { color: var(--blue); }
  .summary-label {
    font-size: 10px; letter-spacing: 0.10em;
    text-transform: uppercase; color: var(--text-dim);
  }

  .divider {
    height: 1px; margin-bottom: 16px;
    background: linear-gradient(90deg, transparent, var(--border) 20%, var(--border) 80%, transparent);
  }

  .sessions { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }

  .session {
    display: flex; text-decoration: none; color: inherit;
    background: var(--bg-panel);
    border: 1px solid var(--border-neutral);
    cursor: pointer; transition: all 0.15s ease;
    position: relative;
  }
  .session:hover {
    background: var(--bg-panel-hover);
    border-color: var(--border);
    box-shadow: 0 0 20px rgba(245, 124, 37, 0.06);
  }

  .session-accent {
    width: 3px; flex-shrink: 0;
    background: var(--border-neutral);
    transition: background 0.15s;
  }
  .session.waiting .session-accent { background: var(--orange); }
  .session.working .session-accent { background: var(--blue); }
  .session:hover .session-accent { background: var(--orange); }

  .session-body { flex: 1; padding: 10px 14px; min-width: 0; }

  .session-top { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; }
  .session-name {
    font-family: var(--font-heading); font-size: 15px; font-weight: 600;
    color: var(--text-bright); letter-spacing: 0.06em;
  }
  .session-status {
    font-family: var(--font-heading); font-size: 10px; font-weight: 600;
    letter-spacing: 0.12em; text-transform: uppercase;
  }
  .session-status.waiting { color: var(--orange); }
  .session-status.working { color: var(--blue); }
  .session-status.idle { color: var(--text-dim); }
  .session-status.dead { color: var(--red-dim); }

  .session-path { font-size: 10px; color: var(--text-dim); font-family: var(--font-mono); margin-bottom: 4px; }
  .session-snippet {
    font-size: 11px; color: var(--text); margin-bottom: 4px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .session-meta {
    font-family: var(--font-data); font-size: 10px; color: var(--text-dim);
    display: flex; gap: 14px; letter-spacing: 0.04em;
  }
  .managed-badge {
    color: var(--orange-dim); border: 1px solid var(--border);
    padding: 0 5px; font-size: 9px; letter-spacing: 0.10em;
  }

  .empty {
    font-family: var(--font-heading); font-size: 13px;
    letter-spacing: 0.10em; color: var(--text-dim);
    padding: 60px 0; text-align: center;
  }
  .cursor { animation: blink 1s step-end infinite; color: var(--orange); }
  @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
</style>
