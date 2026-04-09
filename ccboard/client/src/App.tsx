import { useState, useEffect } from "react";
import { Dashboard } from "./pages/Dashboard";
import { Session } from "./pages/Session";
import { CommandPalette } from "./components/shell/CommandPalette";
import { navLog } from "./lib/utils/logger";

export function App() {
  const [path, setPath] = useState(window.location.pathname);

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
      <CommandPalette />
      {pid ? <Session pid={pid} /> : <Dashboard />}
    </>
  );
}
