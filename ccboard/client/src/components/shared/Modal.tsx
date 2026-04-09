import { useEffect, useCallback, useRef, type ReactNode } from "react";
import { renderLog } from "../../lib/utils/logger";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function Modal({ open, onClose, title, children }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (open) {
      renderLog.debug("Modal opened:", title);
      document.addEventListener("keydown", handleKey);
      return () => document.removeEventListener("keydown", handleKey);
    }
  }, [open, handleKey, title]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 5000,
        background: "var(--bg-overlay)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
      }}
    >
      <div
        style={{
          background: "var(--bg-panel)",
          borderLeft: "3px solid var(--orange)",
          borderTop: "1px solid var(--border)",
          borderRight: "1px solid var(--border)",
          borderBottom: "1px solid var(--border)",
          maxWidth: "800px",
          width: "100%",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Corner brackets */}
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: "20px",
            height: "20px",
            borderTop: "2px solid var(--orange)",
            borderRight: "2px solid var(--orange)",
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: "3px",
            width: "20px",
            height: "20px",
            borderBottom: "2px solid var(--orange)",
            borderLeft: "2px solid var(--orange)",
            pointerEvents: "none",
          }}
        />

        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0.75rem 1rem",
            borderBottom: "1px solid var(--border)",
            fontFamily: "var(--font-heading)",
            fontSize: "1rem",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--orange)",
          }}
        >
          <span>{title}</span>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "1px solid var(--border)",
              color: "var(--text)",
              cursor: "pointer",
              fontFamily: "var(--font-mono)",
              fontSize: "0.8rem",
              padding: "0.2rem 0.5rem",
            }}
          >
            ESC
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "1rem",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
