import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { ActionEvent as ActionEventType } from "../../../lib/types/sse-events";
import { useActions, useSupervisorActions } from "../../../lib/services/socket";
import { renderLog } from "../../../lib/utils/logger";
import { ActionEvent } from "./ActionEvent";
import { ActionDetailModal } from "./ActionDetailModal";

interface ActionsPaneProps {
  pid: number;
}

export function ActionsPane({ pid }: ActionsPaneProps) {
  const [mode, setMode] = useState<"agent" | "supervisor" | "both">("both");
  const agentEvents = useActions(pid);
  const supEvents = useSupervisorActions(pid);
  const [selected, setSelected] = useState<ActionEventType | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Merge and sort by timestamp when showing both
  const events = useMemo(() => {
    if (mode === "agent") return agentEvents;
    if (mode === "supervisor") return supEvents;
    // Both: merge and sort by timestamp
    const merged = [
      ...agentEvents.map(e => ({ ...e, _source: "agent" as const })),
      ...supEvents.map(e => ({ ...e, _source: "sup" as const })),
    ];
    merged.sort((a, b) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return ta - tb;
    });
    return merged;
  }, [mode, agentEvents, supEvents]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  const handleClick = useCallback((evt: ActionEventType) => {
    renderLog.debug("action detail", evt.tool);
    setSelected(evt);
    setModalOpen(true);
  }, []);

  const toggleStyle = (active: boolean): React.CSSProperties => ({
    fontFamily: "var(--font-heading)",
    fontSize: "0.6rem",
    fontWeight: 700,
    letterSpacing: "0.10em",
    textTransform: "uppercase",
    padding: "2px 6px",
    cursor: "pointer",
    border: "1px solid",
    borderColor: active ? "var(--orange)" : "var(--border-neutral)",
    color: active ? "var(--orange)" : "var(--text-dim)",
    background: active ? "var(--orange-faint)" : "transparent",
    transition: "all 0.15s",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{
        padding: "0.4rem 0.75rem", borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", gap: "0.5rem",
      }}>
        <span style={{
          fontFamily: "var(--font-heading)", fontSize: "0.8rem",
          letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--orange)",
        }}>
          ACTIONS
        </span>

        <div style={{ display: "flex", gap: 0 }}>
          <div style={toggleStyle(mode === "both")} onClick={() => setMode("both")}>ALL</div>
          <div style={toggleStyle(mode === "agent")} onClick={() => setMode("agent")}>CC</div>
          <div style={toggleStyle(mode === "supervisor")} onClick={() => setMode("supervisor")}>SUP</div>
        </div>

        <span style={{ color: "var(--text-dim)", fontSize: "0.65rem", fontFamily: "var(--font-data)" }}>
          {events.length}
        </span>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto" }}>
        {events.length === 0 && (
          <div style={{
            padding: "1rem", fontFamily: "var(--font-body)", fontSize: "0.8rem",
            color: "var(--text-dim)", textAlign: "center",
          }}>
            No actions yet
          </div>
        )}
        {events.map((evt, i) => {
          const source = "_source" in evt ? (evt as { _source: string })._source : "agent";
          return (
            <div key={i} style={{ position: "relative" }}>
              {mode === "both" && (
                <span style={{
                  position: "absolute", left: 2, top: "50%", transform: "translateY(-50%)",
                  width: 3, height: "60%", borderRadius: 1,
                  background: source === "sup" ? "var(--blue)" : "var(--orange-dim)",
                  opacity: 0.5,
                }} />
              )}
              <ActionEvent event={evt} onClick={() => handleClick(evt)} />
            </div>
          );
        })}
      </div>

      <ActionDetailModal
        event={selected}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </div>
  );
}
