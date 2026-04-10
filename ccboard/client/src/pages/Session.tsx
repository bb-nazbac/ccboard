import { useState, useEffect, useCallback, useRef } from "react";
import { navLog, renderLog } from "../lib/utils/logger";
import { formatTokens } from "../lib/utils/time";
import { useSessions, useContext, useSupervisorStatus, useAllSupervisorStatuses } from "../lib/services/socket";
import { SupervisorPane } from "../components/session/supervisor/SupervisorPane";
import { MessagesPane } from "../components/session/messages/MessagesPane";
import { ActionsPane } from "../components/session/actions/ActionsPane";
import { ReviewsPane } from "../components/session/reviews/ReviewsPane";

interface SessionProps {
  pid: number;
}

export function Session({ pid }: SessionProps) {
  const sessions = useSessions();
  const context = useContext(pid);
  const supervisorStatus = useSupervisorStatus(pid);
  const [leftWidth, setLeftWidth] = useState(25);
  const [rightWidth, setRightWidth] = useState(35);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentSession = sessions.find((s) => s.pid === pid) || null;
  const supTmux = supervisorStatus?.tmuxSession ?? null;
  const supervisorStatusMap = useAllSupervisorStatuses();

  // Block Cmd+Arrow browser back/forward (we handle navigation ourselves)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Resizable panes
  const startDragLeft = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = leftWidth;
      const onMove = (me: MouseEvent) => {
        const container = containerRef.current;
        if (!container) return;
        const delta = ((me.clientX - startX) / container.clientWidth) * 100;
        const newW = Math.max(15, Math.min(45, startW + delta));
        setLeftWidth(newW);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [leftWidth]
  );

  const startDragRight = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = rightWidth;
      const onMove = (me: MouseEvent) => {
        const container = containerRef.current;
        if (!container) return;
        const delta = ((startX - me.clientX) / container.clientWidth) * 100;
        const newW = Math.max(20, Math.min(50, startW + delta));
        setRightWidth(newW);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [rightWidth]
  );

  const tokenPct = context
    ? Math.min(100, (context.totalContextTokens / 200000) * 100)
    : 0;

  renderLog.debug("Session render", pid);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Tab bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          background: "var(--bg-header)",
          borderBottom: "1px solid var(--border)",
          overflow: "hidden",
        }}
      >
        {/* Back to dashboard */}
        <div
          onClick={() => {
            navLog.info("back to dashboard");
            window.location.href = "/";
          }}
          style={{
            padding: "0.4rem 0.75rem",
            fontFamily: "var(--font-heading)",
            fontSize: "0.75rem",
            letterSpacing: "0.1em",
            color: "var(--orange)",
            cursor: "pointer",
            borderRight: "1px solid var(--border-neutral)",
            flexShrink: 0,
          }}
        >
          CCBOARD
        </div>

        {/* Session tabs */}
        <div
          style={{
            display: "flex",
            flex: 1,
            overflowX: "auto",
          }}
        >
          {sessions.map((s) => {
            // "Waiting for me": session is waiting, recent activity (< 1hr), and supervisor is not working
            const isWaiting = s.status === "waiting";
            const recentActivity = s.lastActivity && (Date.now() - s.lastActivity) < 3600000;
            const supSt = supervisorStatusMap.get(s.pid);
            const supIdle = !supSt?.active || supSt?.isWaiting;
            const needsAttention = isWaiting && recentActivity && supIdle && s.pid !== pid;

            return (
              <div
                key={s.pid}
                onClick={() => {
                  if (s.pid !== pid) {
                    navLog.info("switch session", s.pid);
                    window.location.href = `/session/${s.pid}`;
                  }
                }}
                style={{
                  padding: "0.4rem 0.75rem",
                  fontFamily: "var(--font-data)",
                  fontSize: "0.7rem",
                  letterSpacing: "0.04em",
                  color: s.pid === pid ? "var(--orange)" : needsAttention ? "var(--text-bright)" : "var(--text-dim)",
                  borderBottom: s.pid === pid ? "2px solid var(--orange)" : "2px solid transparent",
                  cursor: s.pid === pid ? "default" : "pointer",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                  position: "relative",
                  animation: needsAttention ? "divisionBreathe 3s ease-in-out infinite" : "none",
                }}
              >
                {s.shortName || `PID ${s.pid}`}
              </div>
            );
          })}
        </div>
      </div>

      {/* Context bar */}
      {context && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "1rem",
            padding: "0.3rem 1rem",
            background: "var(--bg-panel)",
            borderBottom: "1px solid var(--border-neutral)",
            fontFamily: "var(--font-data)",
            fontSize: "0.65rem",
            letterSpacing: "0.06em",
            color: "var(--text-dim)",
          }}
        >
          {/* Token bar */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", minWidth: "140px" }}>
            <span style={{ color: "var(--text)" }}>TOKENS</span>
            <div
              style={{
                flex: 1,
                height: "4px",
                background: "rgba(255,255,255,0.05)",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${tokenPct}%`,
                  height: "100%",
                  background: tokenPct > 80 ? "var(--red)" : "var(--orange)",
                  boxShadow: `0 0 6px ${tokenPct > 80 ? "var(--red)" : "var(--orange-glow)"}`,
                  transition: "width 0.3s",
                }}
              />
            </div>
            <span>{formatTokens(context.totalContextTokens)}</span>
          </div>

          <span>TURNS {context.totalTurns}</span>
          <span>TOOLS {context.totalToolCalls}</span>
          <span>MSGS {context.totalMessages}</span>
          <span>{tokenPct.toFixed(0)}%</span>
        </div>
      )}

      {/* Three-pane layout */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          display: "flex",
          overflow: "hidden",
        }}
      >
        {/* Left: Supervisor */}
        <div style={{ width: `${leftWidth}%`, flexShrink: 0, overflow: "hidden" }}>
          <SupervisorPane pid={pid} tmuxSession={supTmux} />
        </div>

        {/* Drag handle left */}
        <div
          onMouseDown={startDragLeft}
          style={{
            width: "4px",
            cursor: "col-resize",
            background: "var(--border-neutral)",
            flexShrink: 0,
            transition: "background 0.1s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--orange-dim)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "var(--border-neutral)")}
        />

        {/* Center: Actions (top) + Reviews (bottom) */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            minWidth: 0,
          }}
        >
          <div style={{ flex: 1, overflow: "hidden" }}>
            <ActionsPane pid={pid} />
          </div>
          <div
            style={{
              height: "1px",
              background: "var(--border)",
              flexShrink: 0,
            }}
          />
          <div style={{ flex: 1, overflow: "hidden" }}>
            <ReviewsPane pid={pid} />
          </div>
        </div>

        {/* Drag handle right */}
        <div
          onMouseDown={startDragRight}
          style={{
            width: "4px",
            cursor: "col-resize",
            background: "var(--border-neutral)",
            flexShrink: 0,
            transition: "background 0.1s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--orange-dim)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "var(--border-neutral)")}
        />

        {/* Right: Agent messages */}
        <div style={{ width: `${rightWidth}%`, flexShrink: 0, overflow: "hidden" }}>
          <MessagesPane
            pid={pid}
            tmuxSession={currentSession?.tmuxSession || null}
            tty={currentSession?.tty || null}
          />
        </div>
      </div>
    </div>
  );
}
