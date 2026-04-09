import { useState, useEffect, useRef, useCallback } from "react";
import type { ChatMessage as ChatMessageType } from "../../../lib/types/api";
import type { SupervisorStreamEvent } from "../../../lib/types/sse-events";
import {
  getSupervisorStatus,
  getSupervisorMessages,
  sendSupervisorMessage,
  startSupervisor,
} from "../../../lib/services/api";
import { createSSE } from "../../../lib/services/sse";
import { apiLog, sseLog, renderLog } from "../../../lib/utils/logger";
import { ChatMessage } from "../messages/ChatMessage";

interface SupervisorPaneProps {
  pid: number;
  tmuxSession: string | null;
}

export function SupervisorPane({ pid, tmuxSession }: SupervisorPaneProps) {
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [isActive, setIsActive] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [starting, setStarting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load status + initial messages
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await getSupervisorStatus(pid);
        if (cancelled) return;
        setIsActive(status.active);
        setIsWaiting(status.isWaiting || false);
        apiLog.debug("supervisor status", status);

        if (status.active) {
          const msgs = await getSupervisorMessages(pid, 50);
          if (cancelled) return;
          setMessages(msgs);
          apiLog.debug("supervisor messages loaded", msgs.length);
        }
      } catch (err) {
        apiLog.warn("supervisor status failed", err);
      }
    })();
    return () => { cancelled = true; };
  }, [pid]);

  // SSE
  useEffect(() => {
    if (!isActive) return;

    const sse = createSSE<SupervisorStreamEvent>(
      `/api/sessions/${pid}/supervisor/stream`,
      (data) => {
        if (data.type === "message") {
          sseLog.debug("supervisor msg", data.role);
          setMessages((prev) => [...prev, { role: data.role, text: data.text, timestamp: data.timestamp }]);
        } else if (data.type === "status") {
          setIsWaiting(data.isWaiting);
        }
      }
    );
    sse.connect();
    return () => sse.disconnect();
  }, [pid, isActive]);

  // Auto-scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    renderLog.debug("supervisor send", text.slice(0, 40));
    try {
      await sendSupervisorMessage(pid, text);
      setInput("");
      setIsWaiting(false);
    } catch (err) {
      apiLog.error("supervisor send failed", err);
    } finally {
      setSending(false);
    }
  }, [input, sending, pid]);

  const handleStart = useCallback(async () => {
    setStarting(true);
    try {
      const res = await startSupervisor(pid);
      apiLog.info("supervisor started", res);
      setIsActive(true);
    } catch (err) {
      apiLog.error("supervisor start failed", err);
    } finally {
      setStarting(false);
    }
  }, [pid]);

  const tmuxCmd = tmuxSession ? `tmux attach -t ${tmuxSession}` : null;

  const copyTmux = useCallback(() => {
    if (tmuxCmd) navigator.clipboard.writeText(tmuxCmd);
  }, [tmuxCmd]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        borderRight: "1px solid var(--border-neutral)",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "0.5rem 0.75rem",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "0.8rem",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--orange)",
          }}
        >
          SUPERVISOR
        </span>
        <span
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            background: isActive
              ? isWaiting
                ? "var(--orange)"
                : "var(--green)"
              : "var(--text-dim)",
            flexShrink: 0,
          }}
        />
        {tmuxCmd && (
          <span
            onClick={copyTmux}
            title="Click to copy"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.6rem",
              color: "var(--text-dim)",
              cursor: "pointer",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {tmuxCmd}
          </span>
        )}
      </div>

      {/* Body */}
      {!isActive ? (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <button
            onClick={handleStart}
            disabled={starting}
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: "0.85rem",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--orange)",
              background: "var(--orange-faint)",
              border: "1px solid var(--orange)",
              padding: "0.6rem 1.5rem",
              cursor: starting ? "wait" : "pointer",
              opacity: starting ? 0.5 : 1,
            }}
          >
            {starting ? "STARTING..." : "START SUPERVISOR"}
          </button>
        </div>
      ) : (
        <>
          <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "0.5rem" }}>
            {messages.length === 0 && (
              <div
                style={{
                  padding: "1rem",
                  fontFamily: "var(--font-body)",
                  fontSize: "0.8rem",
                  color: "var(--text-dim)",
                  textAlign: "center",
                }}
              >
                Supervisor active. Waiting for messages...
              </div>
            )}
            {messages.map((msg, i) => (
              <ChatMessage key={i} message={msg} />
            ))}
          </div>

          {/* Input */}
          <div
            style={{
              padding: "0.5rem",
              borderTop: "1px solid var(--border)",
              display: "flex",
              gap: "0.4rem",
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              disabled={!isWaiting || sending}
              placeholder={isWaiting ? "Send to supervisor..." : "Supervisor is working..."}
              style={{
                flex: 1,
                background: "rgba(0,0,0,0.3)",
                border: "1px solid var(--border)",
                color: "var(--text-bright)",
                fontFamily: "var(--font-body)",
                fontSize: "0.8rem",
                padding: "0.4rem 0.6rem",
                outline: "none",
              }}
            />
            <button
              onClick={handleSend}
              disabled={!isWaiting || sending || !input.trim()}
              style={{
                fontFamily: "var(--font-data)",
                fontSize: "0.7rem",
                letterSpacing: "0.08em",
                color: "var(--orange)",
                background: "var(--orange-faint)",
                border: "1px solid var(--border)",
                padding: "0.4rem 0.8rem",
                cursor: !isWaiting || sending ? "default" : "pointer",
                opacity: !isWaiting || sending || !input.trim() ? 0.4 : 1,
              }}
            >
              SEND
            </button>
          </div>
        </>
      )}
    </div>
  );
}
