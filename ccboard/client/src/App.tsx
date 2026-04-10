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
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const sessionMatch = path.match(/^\/session\/(\d+)$/);
  const pid = sessionMatch?.[1] ? Number(sessionMatch[1]) : null;

  navLog.debug("route", { path, pid });

  return (
    <>
      {!connected && (
        <div
          style={{
            background: "var(--orange)",
            padding: "4px",
            textAlign: "center",
            fontSize: "11px",
            fontFamily: "var(--font-heading)",
            letterSpacing: "0.08em",
            color: "var(--bg)",
            fontWeight: 700,
          }}
        >
          RECONNECTING...
        </div>
      )}
      <CommandPalette />
      {pid ? <Session pid={pid} /> : <Dashboard />}
    </>
  );
}
