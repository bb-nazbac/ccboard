import { useState, useEffect, useRef, useCallback } from "react";
import type { ActionEvent as ActionEventType } from "../../../lib/types/sse-events";
import type { ActionStreamEvent } from "../../../lib/types/sse-events";
import { getActions } from "../../../lib/services/api";
import { createSSE } from "../../../lib/services/sse";
import { apiLog, sseLog, renderLog } from "../../../lib/utils/logger";
import { ActionEvent } from "./ActionEvent";
import { ActionDetailModal } from "./ActionDetailModal";

const MAX_EVENTS = 500;
const INITIAL_TURNS = 20;

interface ActionsPaneProps {
  pid: number;
}

export function ActionsPane({ pid }: ActionsPaneProps) {
  const [events, setEvents] = useState<ActionEventType[]>([]);
  const [selected, setSelected] = useState<ActionEventType | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load historical actions
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const turns = await getActions(pid);
        if (cancelled) return;
        const capped = turns.slice(-INITIAL_TURNS);
        const flat: ActionEventType[] = [];
        for (const turn of capped) {
          for (const a of turn.actions) {
            if (a.type === "tool_use" && a.tool) {
              flat.push({
                type: "action",
                tool: a.tool,
                detail: a.text || a.description || "",
                timestamp: a.timestamp,
                filePath: a.filePath,
                command: a.command,
                description: a.description,
                oldString: a.oldString,
                newString: a.newString,
                pattern: a.pattern,
                path: a.path,
              });
            }
          }
        }
        apiLog.debug("actions loaded", flat.length);
        setEvents(flat);
      } catch (err) {
        apiLog.warn("actions fetch failed", err);
      }
    })();
    return () => { cancelled = true; };
  }, [pid]);

  // SSE for real-time actions
  useEffect(() => {
    const sse = createSSE<ActionStreamEvent>(
      `/api/sessions/${pid}/action-stream`,
      (data) => {
        if (data.type === "action") {
          const evt = data as ActionEventType;
          sseLog.debug("action-stream event", evt.tool);
          setEvents((prev) => {
            const next = [...prev, evt];
            return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
          });
        }
      }
    );
    sse.connect();
    return () => sse.disconnect();
  }, [pid]);

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
