import type { ActionEvent as ActionEventType } from "../../../lib/types/sse-events";
import { formatTime } from "../../../lib/utils/time";
import { shortenPath } from "../../../lib/utils/html";

interface ActionEventProps {
  event: ActionEventType;
  onClick: () => void;
}

const TOOL_COLORS: Record<string, string> = {
  Bash: "var(--orange)",
  Read: "var(--blue)",
  Write: "var(--green)",
  Edit: "var(--green-dim)",
  Glob: "var(--blue-dim)",
  Grep: "var(--blue-dim)",
  Agent: "var(--blue)",
  WebSearch: "var(--purple)",
  WebFetch: "var(--purple)",
  TodoWrite: "var(--yellow)",
};

function getToolColor(tool: string): string {
  return TOOL_COLORS[tool] || "var(--text-dim)";
}

export function ActionEvent({ event, onClick }: ActionEventProps) {
  const detail =
    event.filePath
      ? shortenPath(event.filePath)
      : event.command
        ? event.command.slice(0, 80)
        : event.detail?.slice(0, 80) || "";

  return (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.3rem 0.5rem",
        cursor: "pointer",
        borderBottom: "1px solid var(--border-neutral)",
        fontFamily: "var(--font-data)",
        fontSize: "0.75rem",
        transition: "background 0.1s",
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.background = "var(--bg-panel-hover)")
      }
      onMouseLeave={(e) =>
        (e.currentTarget.style.background = "transparent")
      }
    >
      <span
        style={{
          color: "var(--text-dim)",
          fontFamily: "var(--font-mono)",
          fontSize: "0.65rem",
          minWidth: "55px",
        }}
      >
        {formatTime(event.timestamp)}
      </span>
      <span
        style={{
          color: getToolColor(event.tool),
          fontWeight: 600,
          minWidth: "50px",
          letterSpacing: "0.04em",
        }}
      >
        {event.tool}
      </span>
      <span
        style={{
          color: "var(--text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          flex: 1,
        }}
      >
        {detail}
      </span>
    </div>
  );
}
