import { useState, useEffect, useRef, useCallback } from "react";
import type { ActionEvent as ActionEventType } from "../../../lib/types/sse-events";
import { useActions } from "../../../lib/services/socket";
import { renderLog } from "../../../lib/utils/logger";
import { ActionEvent } from "./ActionEvent";
import { ActionDetailModal } from "./ActionDetailModal";

interface ActionsPaneProps {
  pid: number;
}

export function ActionsPane({ pid }: ActionsPaneProps) {
  const events = useActions(pid);
  const [selected, setSelected] = useState<ActionEventType | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  const handleClick = useCallback((evt: ActionEventType) => {
    renderLog.debug("action detail", evt.tool);
    setSelected(evt);
    setModalOpen(true);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          padding: "0.5rem 0.75rem",
          borderBottom: "1px solid var(--border)",
          fontFamily: "var(--font-heading)",
          fontSize: "0.8rem",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--orange)",
        }}
      >
        ACTIONS
        <span style={{ color: "var(--text-dim)", marginLeft: "0.5rem", fontSize: "0.7rem" }}>
          {events.length}
        </span>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto" }}>
        {events.length === 0 && (
          <div
            style={{
              padding: "1rem",
              fontFamily: "var(--font-body)",
              fontSize: "0.8rem",
              color: "var(--text-dim)",
              textAlign: "center",
            }}
          >
            No actions yet
          </div>
        )}
        {events.map((evt, i) => (
          <ActionEvent key={i} event={evt} onClick={() => handleClick(evt)} />
        ))}
      </div>

      <ActionDetailModal
        event={selected}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </div>
  );
}
