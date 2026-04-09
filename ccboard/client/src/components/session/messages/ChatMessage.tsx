import { useMemo } from "react";
import type { ChatMessage as ChatMessageType } from "../../../lib/types/api";
import { renderMarkdown } from "../../../lib/utils/markdown";
import { formatTime } from "../../../lib/utils/time";

interface ChatMessageProps {
  message: ChatMessageType;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isHuman = message.role === "human";

  const rendered = useMemo(() => {
    if (isHuman) return null;
    return renderMarkdown(message.text);
  }, [message.text, isHuman]);

  return (
    <div
      style={{
        borderLeft: `3px solid ${isHuman ? "var(--orange)" : "var(--border-neutral)"}`,
        padding: "0.5rem 0.75rem",
        marginBottom: "0.5rem",
        background: isHuman ? "var(--orange-faint)" : "transparent",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          marginBottom: "0.25rem",
          fontFamily: "var(--font-data)",
          fontSize: "0.7rem",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        <span style={{ color: isHuman ? "var(--orange)" : "var(--blue)" }}>
          {isHuman ? "YOU" : "AGENT"}
        </span>
        {message.timestamp && (
          <span style={{ color: "var(--text-dim)" }}>
            {formatTime(message.timestamp)}
          </span>
        )}
      </div>

      {isHuman ? (
        <div
          style={{
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            color: "var(--text-bright)",
            fontFamily: "var(--font-body)",
            fontSize: "0.85rem",
            lineHeight: 1.5,
          }}
        >
          {message.text}
        </div>
      ) : (
        <div
          style={{
            color: "var(--text)",
            fontFamily: "var(--font-body)",
            fontSize: "0.85rem",
            lineHeight: 1.5,
            wordBreak: "break-word",
          }}
          dangerouslySetInnerHTML={{ __html: rendered! }}
        />
      )}
    </div>
  );
}
