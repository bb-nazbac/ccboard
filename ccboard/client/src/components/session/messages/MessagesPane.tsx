import { useState, useEffect, useRef, useCallback } from "react";
import type { ChatMessage as ChatMessageType } from "../../../lib/types/api";
import type { AgentMessageEvent, PaneEvent } from "../../../lib/types/sse-events";
import { getMessages, sendMessage } from "../../../lib/services/api";
import { createSSE } from "../../../lib/services/sse";
import { apiLog, sseLog, renderLog } from "../../../lib/utils/logger";
import { ChatMessage } from "./ChatMessage";

const MAX_MESSAGES = 100;

interface MessagesPaneProps {
  pid: number;
  tmuxSession: string | null;
  tty: string | null;
}

export function MessagesPane({ pid, tmuxSession, tty }: MessagesPaneProps) {
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [workingText, setWorkingText] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string>("idle");
  const scrollRef = useRef<HTMLDivElement>(null);
  const managed = !!tmuxSession;

  // Load historical messages
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const msgs = await getMessages(pid);
        if (cancelled) return;
        setMessages(msgs.slice(-MAX_MESSAGES));
        apiLog.debug("messages loaded", msgs.length);
      } catch (err) {
        apiLog.warn("messages fetch failed", err);
      }
    })();
    return () => { cancelled = true; };
  }, [pid]);

  // SSE for new messages
  useEffect(() => {
    const sse = createSSE<AgentMessageEvent>(
      `/api/sessions/${pid}/stream`,
      (data) => {
        if (data.type === "message") {
          sseLog.debug("agent msg", data.role);
          setMessages((prev) => {
            const next = [...prev, { role: data.role, text: data.text, timestamp: data.timestamp }];
            return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
          });
        }
      }
    );
    sse.connect();
    return () => sse.disconnect();
  }, [pid]);

  // SSE for pane status / working text
  useEffect(() => {
    const sse = createSSE<PaneEvent>(
      `/api/sessions/${pid}/pane-stream`,
      (data) => {
        if (data.type === "pane") {
          setStatus(data.status);
          setWorkingText(data.workingText || null);
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
  }, [messages.length, workingText]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending || !managed) return;
    setSending(true);
    renderLog.debug("agent send", text.slice(0, 40));
    try {
      await sendMessage(pid, text);
      setInput("");
    } catch (err) {
      apiLog.error("agent send failed", err);
    } finally {
      setSending(false);
    }
  }, [input, sending, pid, managed]);

  const tmuxCmd = tmuxSession
    ? `tmux attach -t ${tmuxSession}`
    : tty
      ? `screen ${tty}`
      : null;

  const copyCmd = useCallback(() => {
    if (tmuxCmd) navigator.clipboard.writeText(tmuxCmd);
  }, [tmuxCmd]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
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
          AGENT
        </span>
        <span
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            background:
              status === "working"
                ? "var(--green)"
                : status === "waiting"
                  ? "var(--orange)"
                  : "var(--text-dim)",
            flexShrink: 0,
          }}
        />
        {tmuxCmd && (
          <span
            onClick={copyCmd}
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

      {/* Messages */}
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
            No messages yet
          </div>
        )}
        {messages.map((msg, i) => (
          <ChatMessage key={i} message={msg} />
        ))}

        {/* Working text overlay */}
        {workingText && (
          <div
            style={{
              padding: "0.4rem 0.75rem",
              borderLeft: "3px solid var(--orange-dim)",
              background: "var(--orange-faint)",
              fontFamily: "var(--font-mono)",
              fontSize: "0.75rem",
              color: "var(--orange-dim)",
              whiteSpace: "pre-wrap",
              opacity: 0.8,
            }}
          >
            {workingText}
          </div>
        )}
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
        {managed ? (
          <>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              disabled={sending}
              placeholder="Send to agent..."
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
              disabled={sending || !input.trim()}
              style={{
                fontFamily: "var(--font-data)",
                fontSize: "0.7rem",
                letterSpacing: "0.08em",
                color: "var(--orange)",
                background: "var(--orange-faint)",
                border: "1px solid var(--border)",
                padding: "0.4rem 0.8rem",
                cursor: sending || !input.trim() ? "default" : "pointer",
                opacity: sending || !input.trim() ? 0.4 : 1,
              }}
            >
              SEND
            </button>
          </>
        ) : (
          <div
            style={{
              flex: 1,
              fontFamily: "var(--font-body)",
              fontSize: "0.75rem",
              color: "var(--text-dim)",
              padding: "0.4rem",
              textAlign: "center",
            }}
          >
            Not managed -- use terminal directly
          </div>
        )}
      </div>
    </div>
  );
}
