import { useState, useEffect } from "react";
import { Dashboard } from "./pages/Dashboard";
import { Session } from "./pages/Session";
import { CommandPalette } from "./components/shell/CommandPalette";
import { navLog } from "./lib/utils/logger";
import { initSocket, useConnected } from "./lib/services/socket";

// Initialise socket connection once
initSocket();

export function App() {
  const [path, setPath] = useState(window.location.pathname);
  const connected = useConnected();

  useEffect(() => {
    const onPop = () => {
      navLog.info("popstate →", window.location.pathname);
      setPath(window.location.pathname);
    };
    // Block Cmd+Arrow browser back/forward
    const blockNav = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
      }
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("keydown", blockNav);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("keydown", blockNav);
    };
  }, []);

  const sessionMatch = path.match(/^\/session\/(\d+)$/);
  const pid = sessionMatch?.[1] ? Number(sessionMatch[1]) : null;

  navLog.debug("route", { path, pid });

  return (
    <>
      {/* Content — blurred when disconnected */}
      <div style={{ height: "100%", filter: connected ? "none" : "blur(4px)", transition: "filter 0.2s" }}>
        <CommandPalette />
        {pid ? <Session pid={pid} /> : <Dashboard />}
      </div>

      {/* Reconnecting overlay */}
      {!connected && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9500,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: "16px",
              fontWeight: 700,
              letterSpacing: "0.15em",
              color: "var(--orange)",
              textShadow: "0 0 20px var(--orange-glow), 0 0 40px var(--orange-glow)",
              animation: "pulse 1.5s ease-in-out infinite",
            }}
          >
            RECONNECTING...
          </div>
        </div>
      )}
    </>
  );
}
