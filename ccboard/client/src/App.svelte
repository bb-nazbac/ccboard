<script lang="ts">
  import Dashboard from "./lib/pages/Dashboard.svelte";
  import Session from "./lib/pages/Session.svelte";
  import CommandPalette from "./lib/components/shell/CommandPalette.svelte";

  // Reactive path tracking — use a module-level setter so navigateTo can trigger updates
  let currentPath = $state(window.location.pathname);

  // Expose a global function for navigation
  (window as unknown as Record<string, unknown>).__ccboardNavigate = (path: string) => {
    window.history.pushState({}, "", path);
    currentPath = path;
  };

  // Also handle browser back/forward
  $effect(() => {
    const onPopState = () => { currentPath = window.location.pathname; };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  });

  // Derive route
  let route = $derived.by(() => {
    const sessionMatch = currentPath.match(/^\/session\/(\d+)$/);
    if (sessionMatch?.[1]) return { page: "session" as const, pid: Number(sessionMatch[1]) };
    return { page: "dashboard" as const, pid: 0 };
  });
</script>

<CommandPalette />

{#if route.page === "session"}
  <Session pid={route.pid} />
{:else}
  <Dashboard />
{/if}
