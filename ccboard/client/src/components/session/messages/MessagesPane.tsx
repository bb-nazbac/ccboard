import { useState, useEffect, useRef, useCallback } from "react";
import { sendMessage } from "../../../lib/services/api";
import { useMessages, usePaneState } from "../../../lib/services/socket";
import { apiLog, renderLog } from "../../../lib/utils/logger";
import { ChatMessage } from "./ChatMessage";

interface MessagesPaneProps {
  pid: number;
  tmuxSession: string | null;
  tty: string | null;
}

export function MessagesPane({ pid, tmuxSession, tty }: MessagesPaneProps) {
  const messages = useMessages(pid);
  const paneState = usePaneState(pid);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const managed = !!tmuxSession;

  const status = paneState?.status ?? "idle";
  const workingText = paneState?.workingText ?? null;

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

  const tmuxCmd = tmuxSession ? `tmux attach -t ${tmuxSession}` : tty ? `TTY: ${tty}` : null;
  const copyCmd = useCallback(() => {
    if (tmuxSession) navigator.clipboard.writeText(`tmux attach -t ${tmuxSession}`);
    else if (tty) navigator.clipboard.writeText(tty);
  }, [tmuxSession, tty]);

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
          AGENT
        </span>
        <span style={{
          width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
          background: status === "working" ? "var(--green)" : status === "waiting" ? "var(--orange)" : "var(--text-dim)",
        }} />
        {tmuxCmd && (
          <span onClick={copyCmd} title="Click to copy" style={{
            fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "var(--text-dim)",
            cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {tmuxCmd}
          </span>
        )}
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "0.5rem" }}>
        {messages.length === 0 && (
          <div style={{
            padding: "1rem", fontFamily: "var(--font-body)", fontSize: "0.8rem",
            color: "var(--text-dim)", textAlign: "center",
          }}>
            No messages yet
          </div>
        )}
        {messages.map((msg, i) => (
          <ChatMessage key={i} message={msg} />
        ))}
        {workingText && (
          <div style={{
            padding: "0.4rem 0.75rem", borderLeft: "3px solid var(--orange-dim)",
            background: "var(--orange-faint)", fontFamily: "var(--font-mono)",
            fontSize: "0.75rem", color: "var(--orange-dim)", whiteSpace: "pre-wrap", opacity: 0.8,
          }}>
            {workingText}
          </div>
        )}
      </div>

      <div style={{ padding: "0.5rem", borderTop: "1px solid var(--border)", display: "flex", gap: "0.4rem" }}>
        {managed ? (
          <>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              disabled={sending}
              placeholder="Send to agent..."
              style={{
                flex: 1, background: "rgba(10,10,10,0.8)", border: "1px solid var(--border-neutral)",
                color: "var(--text-bright)", fontFamily: "var(--font-body)", fontSize: "0.8rem",
                padding: "0.4rem 0.6rem", outline: "none",
              }}
            />
            <button onClick={handleSend} disabled={sending} style={{
              fontFamily: "var(--font-heading)", fontSize: "0.7rem", fontWeight: 700,
              background: "var(--orange-faint)", border: "1px solid var(--border)",
              color: "var(--orange)", cursor: "pointer", padding: "0.3rem 0.6rem", letterSpacing: "0.08em",
            }}>▶</button>
          </>
        ) : (
          <div style={{
            flex: 1, fontFamily: "var(--font-body)", fontSize: "0.75rem",
            color: "var(--text-dim)", padding: "0.4rem", textAlign: "center",
          }}>
            Not managed — use terminal directly
          </div>
        )}
      </div>
    </div>
  );
}
