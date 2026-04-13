import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { navLog, renderLog } from "../../lib/utils/logger";

interface Command {
  id: string;
  label: string;
  action: () => void;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands: Command[] = useMemo(
    () => [
      {
        id: "dashboard",
        label: "Go to Dashboard",
        action: () => {
          navLog.info("command: dashboard");
          window.location.href = "/";
        },
      },
      {
        id: "new-feature",
        label: "New Feature",
        action: () => {
          renderLog.info("command: new-feature");
          window.dispatchEvent(new CustomEvent("ccboard:new-feature"));
        },
      },
      {
        id: "complete-feature",
        label: "Complete Feature",
        action: () => {
          renderLog.info("command: complete-feature");
          window.dispatchEvent(new CustomEvent("ccboard:complete-feature"));
        },
      },
      {
        id: "switch-feature",
        label: "Switch Feature",
        action: () => {
          renderLog.info("command: switch-feature");
          window.dispatchEvent(new CustomEvent("ccboard:switch-feature"));
        },
      },
      {
        id: "toggle-theme",
        label: "Toggle Theme",
        action: () => {
          const current = localStorage.getItem("ccboard-theme") || "dark";
          const next = current === "light" ? "dark" : "light";
          document.documentElement.setAttribute("data-theme", next);
          localStorage.setItem("ccboard-theme", next);
          renderLog.info("theme:", next);
        },
      },
      {
        id: "dark-theme",
        label: "Dark Theme",
        action: () => {
          document.documentElement.setAttribute("data-theme", "dark");
          localStorage.setItem("ccboard-theme", "dark");
          renderLog.info("theme: dark");
        },
      },
      {
        id: "light-theme",
        label: "Light Theme",
        action: () => {
          document.documentElement.setAttribute("data-theme", "light");
          localStorage.setItem("ccboard-theme", "light");
          renderLog.info("theme: light");
        },
      },
    ],
    []
  );

  const filtered = useMemo(() => {
    if (!query) return commands;
    const q = query.toLowerCase();
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [commands, query]);

  // Cmd+Shift+P to toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setOpen((prev) => !prev);
        setQuery("");
        setSelectedIdx(0);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Focus input on open
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const execute = useCallback(
    (cmd: Command) => {
      renderLog.debug("execute command", cmd.id);
      setOpen(false);
      cmd.action();
    },
    []
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filtered[selectedIdx]) execute(filtered[selectedIdx]);
      }
    },
    [filtered, selectedIdx, execute]
  );

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  if (!open) return null;

  return (
    <div
      onClick={() => setOpen(false)}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 6000,
        background: "var(--bg-overlay)",
        backdropFilter: "blur(4px)",
        display: "flex",
        justifyContent: "center",
        paddingTop: "15vh",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "400px",
          maxHeight: "320px",
          background: "var(--bg-panel)",
          borderLeft: "3px solid var(--orange)",
          borderTop: "1px solid var(--border)",
          borderRight: "1px solid var(--border)",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a command..."
          style={{
            background: "rgba(0,0,0,0.3)",
            border: "none",
            borderBottom: "1px solid var(--border)",
            color: "var(--text-bright)",
            fontFamily: "var(--font-body)",
            fontSize: "0.85rem",
            padding: "0.6rem 0.75rem",
            outline: "none",
          }}
        />

        <div style={{ flex: 1, overflowY: "auto" }}>
          {filtered.map((cmd, i) => (
            <div
              key={cmd.id}
              onClick={() => execute(cmd)}
              style={{
                padding: "0.5rem 0.75rem",
                fontFamily: "var(--font-body)",
                fontSize: "0.8rem",
                color: i === selectedIdx ? "var(--orange)" : "var(--text)",
                background: i === selectedIdx ? "var(--orange-faint)" : "transparent",
                cursor: "pointer",
                borderLeft: i === selectedIdx ? "2px solid var(--orange)" : "2px solid transparent",
              }}
            >
              {cmd.label}
            </div>
          ))}
          {filtered.length === 0 && (
            <div
              style={{
                padding: "0.75rem",
                fontFamily: "var(--font-body)",
                fontSize: "0.8rem",
                color: "var(--text-dim)",
                textAlign: "center",
              }}
            >
              No matching commands
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
