import type { ActionEvent } from "../../../lib/types/sse-events";
import { Modal } from "../../shared/Modal";
import { formatTime } from "../../../lib/utils/time";
import { escapeHtml } from "../../../lib/utils/html";

interface ActionDetailModalProps {
  event: ActionEvent | null;
  open: boolean;
  onClose: () => void;
}

export function ActionDetailModal({ event, open, onClose }: ActionDetailModalProps) {
  if (!event) return null;

  const labelStyle: React.CSSProperties = {
    color: "var(--orange)",
    fontFamily: "var(--font-heading)",
    fontSize: "0.7rem",
    fontWeight: 700,
    letterSpacing: "0.10em",
    textTransform: "uppercase",
    marginBottom: "0.2rem",
  };

  const valueStyle: React.CSSProperties = {
    color: "var(--text-bright)",
    fontFamily: "var(--font-mono)",
    fontSize: "0.75rem",
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    padding: "0.5rem 0.6rem",
    background: "rgba(0,0,0,0.3)",
    borderLeft: "2px solid var(--border-neutral)",
    marginBottom: "0.75rem",
  };

  const metaStyle: React.CSSProperties = {
    ...valueStyle,
    fontSize: "0.7rem",
    color: "var(--text)",
    padding: "0.3rem 0.6rem",
  };

  // Render a labeled field only if value is truthy
  const field = (label: string, value: string | undefined, style = valueStyle) => {
    if (!value) return null;
    return (
      <>
        <div style={labelStyle}>{label}</div>
        <div style={style}>{value}</div>
      </>
    );
  };

  return (
    <Modal open={open} onClose={onClose} title={`${event.tool}`}>
      {/* Time */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "0.75rem" }}>
        {event.timestamp && (
          <div>
            <div style={labelStyle}>TIME</div>
            <div style={metaStyle}>{formatTime(event.timestamp)}</div>
          </div>
        )}
        {event.tool === "Agent" && event.subagentType && (
          <div>
            <div style={labelStyle}>SUBAGENT TYPE</div>
            <div style={metaStyle}>{event.subagentType}</div>
          </div>
        )}
        {event.tool === "Agent" && event.model && (
          <div>
            <div style={labelStyle}>MODEL</div>
            <div style={metaStyle}>{event.model}</div>
          </div>
        )}
      </div>

      {/* Tool-specific fields */}
      {field("DESCRIPTION", event.description)}
      {field("FILE", event.filePath)}
      {field("COMMAND", event.command)}
      {field("PATTERN", event.pattern)}
      {field("PATH", event.path)}
      {event.tool === "Grep" && field("GLOB", event.glob)}
      {event.tool === "Grep" && field("OUTPUT MODE", event.outputMode)}
      {event.tool === "Read" && event.offset && field("OFFSET", `Line ${event.offset}`)}
      {event.tool === "Read" && event.limit && field("LIMIT", `${event.limit} lines`)}

      {/* Agent: full prompt */}
      {event.tool === "Agent" && event.prompt && (
        <>
          <div style={labelStyle}>FULL PROMPT</div>
          <div style={{
            ...valueStyle,
            maxHeight: "300px",
            overflowY: "auto",
            fontSize: "0.7rem",
            color: "var(--text)",
            borderLeft: "2px solid var(--blue)",
          }}>
            {event.prompt}
          </div>
        </>
      )}

      {/* Detail (fallback for tools that only have generic detail) */}
      {!event.description && !event.command && !event.filePath && !event.prompt && field("DETAIL", event.detail)}

      {/* Edit: old/new diff */}
      {event.oldString && (
        <>
          <div style={labelStyle}>REMOVED</div>
          <div
            style={{
              ...valueStyle,
              borderLeft: "3px solid var(--red)",
              color: "var(--red)",
              maxHeight: "250px",
              overflowY: "auto",
            }}
            dangerouslySetInnerHTML={{ __html: escapeHtml(event.oldString) }}
          />
        </>
      )}

      {event.newString && (
        <>
          <div style={labelStyle}>{event.tool === "Write" ? "CONTENT" : "ADDED"}</div>
          <div
            style={{
              ...valueStyle,
              borderLeft: "3px solid var(--green)",
              color: "var(--green)",
              maxHeight: "250px",
              overflowY: "auto",
            }}
            dangerouslySetInnerHTML={{ __html: escapeHtml(event.newString) }}
          />
        </>
      )}
    </Modal>
  );
}
