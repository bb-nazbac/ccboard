import type { ActionEvent } from "../../../lib/types/sse-events";
import { Modal } from "../../shared/Modal";
import { formatTime } from "../../../lib/utils/time";
import { escapeHtml, shortenPath } from "../../../lib/utils/html";

interface ActionDetailModalProps {
  event: ActionEvent | null;
  open: boolean;
  onClose: () => void;
}

export function ActionDetailModal({ event, open, onClose }: ActionDetailModalProps) {
  if (!event) return null;

  const labelStyle: React.CSSProperties = {
    color: "var(--orange)",
    fontFamily: "var(--font-data)",
    fontSize: "0.7rem",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    marginBottom: "0.2rem",
  };

  const valueStyle: React.CSSProperties = {
    color: "var(--text-bright)",
    fontFamily: "var(--font-mono)",
    fontSize: "0.8rem",
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
    padding: "0.4rem",
    background: "rgba(0,0,0,0.3)",
    marginBottom: "0.75rem",
  };

  return (
    <Modal open={open} onClose={onClose} title={`ACTION: ${event.tool}`}>
      <div style={labelStyle}>TIME</div>
      <div style={valueStyle}>{formatTime(event.timestamp)}</div>

      {event.description && (
        <>
          <div style={labelStyle}>DESCRIPTION</div>
          <div style={valueStyle}>{event.description}</div>
        </>
      )}

      {event.filePath && (
        <>
          <div style={labelStyle}>FILE</div>
          <div style={valueStyle}>{shortenPath(event.filePath, 120)}</div>
        </>
      )}

      {event.command && (
        <>
          <div style={labelStyle}>COMMAND</div>
          <div style={valueStyle}>{event.command}</div>
        </>
      )}

      {event.pattern && (
        <>
          <div style={labelStyle}>PATTERN</div>
          <div style={valueStyle}>{event.pattern}</div>
        </>
      )}

      {event.path && (
        <>
          <div style={labelStyle}>PATH</div>
          <div style={valueStyle}>{event.path}</div>
        </>
      )}

      {event.detail && (
        <>
          <div style={labelStyle}>DETAIL</div>
          <div style={valueStyle}>{event.detail}</div>
        </>
      )}

      {/* Edit: old/new diff */}
      {event.oldString && (
        <>
          <div style={labelStyle}>OLD STRING</div>
          <div
            style={{
              ...valueStyle,
              borderLeft: "3px solid var(--red)",
              color: "var(--red)",
            }}
            dangerouslySetInnerHTML={{ __html: escapeHtml(event.oldString) }}
          />
        </>
      )}

      {event.newString && (
        <>
          <div style={labelStyle}>NEW STRING</div>
          <div
            style={{
              ...valueStyle,
              borderLeft: "3px solid var(--green)",
              color: "var(--green)",
            }}
            dangerouslySetInnerHTML={{ __html: escapeHtml(event.newString) }}
          />
        </>
      )}
    </Modal>
  );
}
