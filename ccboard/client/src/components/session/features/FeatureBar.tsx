import { useState, useCallback } from "react";
import { useActiveFeature } from "../../../lib/services/socket";
import { completeFeature } from "../../../lib/services/api";
import { apiLog } from "../../../lib/utils/logger";
import type { Feature } from "../../../lib/types/api";

interface FeatureBarProps {
  pid: number;
  onNewFeature: () => void;
}

export function FeatureBar({ pid, onNewFeature }: FeatureBarProps) {
  const activeFeature = useActiveFeature(pid);
  const [expanded, setExpanded] = useState(false);
  const [completing, setCompleting] = useState(false);

  const handleComplete = useCallback(async () => {
    if (!activeFeature || completing) return;
    setCompleting(true);
    try {
      await completeFeature(pid, activeFeature.slug);
      apiLog.info("feature completed", activeFeature.slug);
    } catch (err) {
      apiLog.error("feature complete failed", err);
    } finally {
      setCompleting(false);
    }
  }, [pid, activeFeature, completing]);

  if (!activeFeature) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "0.3rem 1rem",
          background: "var(--bg-panel)",
          borderBottom: "1px solid var(--border-neutral)",
          fontFamily: "var(--font-data)",
          fontSize: "0.65rem",
          letterSpacing: "0.06em",
          color: "var(--text-dim)",
        }}
      >
        <span>NO ACTIVE FEATURE</span>
        <span style={{ margin: "0 0.5rem", color: "var(--border)" }}>|</span>
        <span
          onClick={onNewFeature}
          style={{
            color: "var(--orange)",
            cursor: "pointer",
            textDecoration: "underline",
            textDecorationColor: "var(--orange-dim)",
            textUnderlineOffset: "2px",
          }}
        >
          Cmd+Shift+P &rarr; "New Feature"
        </span>
      </div>
    );
  }

  const doneCount = activeFeature.acceptanceCriteria.filter((c) => c.done).length;
  const totalCount = activeFeature.acceptanceCriteria.length;

  return (
    <div
      style={{
        background: "var(--bg-panel)",
        borderBottom: "1px solid var(--border-neutral)",
        borderLeft: "3px solid var(--orange)",
      }}
    >
      {/* Main bar */}
      <div
        onClick={() => setExpanded((e) => !e)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "0.3rem 1rem",
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        {/* Title */}
        <span
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "0.75rem",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--orange)",
          }}
        >
          {activeFeature.title}
        </span>

        {/* Branch */}
        <span
          style={{
            fontFamily: "var(--font-mono, var(--font-data))",
            fontSize: "0.6rem",
            color: "var(--text-dim)",
            letterSpacing: "0.04em",
          }}
        >
          {activeFeature.branch}
        </span>

        {/* Progress */}
        {totalCount > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <span
              style={{
                fontFamily: "var(--font-data)",
                fontSize: "0.65rem",
                color: doneCount === totalCount ? "var(--green)" : "var(--text)",
                letterSpacing: "0.04em",
              }}
            >
              {doneCount}/{totalCount}
            </span>
            {/* Segmented progress bar */}
            <div style={{ display: "flex", gap: "2px" }}>
              {activeFeature.acceptanceCriteria.map((c, i) => (
                <div
                  key={i}
                  style={{
                    width: "12px",
                    height: "4px",
                    background: c.done ? "var(--orange)" : "rgba(255,255,255,0.08)",
                    boxShadow: c.done ? "0 0 4px var(--orange-glow)" : "none",
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Expand indicator */}
        <span
          style={{
            fontFamily: "var(--font-data)",
            fontSize: "0.6rem",
            color: "var(--text-dim)",
          }}
        >
          {expanded ? "\u25B2" : "\u25BC"}
        </span>

        {/* Complete button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleComplete();
          }}
          disabled={completing}
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "0.65rem",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: completing ? "var(--text-dim)" : "var(--green)",
            background: "rgba(0,255,0,0.05)",
            border: "1px solid var(--green)",
            padding: "0.15rem 0.5rem",
            cursor: completing ? "wait" : "pointer",
            opacity: completing ? 0.5 : 1,
          }}
        >
          COMPLETE
        </button>
      </div>

      {/* Expanded: acceptance criteria */}
      {expanded && (
        <div
          style={{
            padding: "0.3rem 1rem 0.5rem 1.5rem",
            borderTop: "1px solid var(--border-neutral)",
          }}
        >
          {activeFeature.description && (
            <div
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "0.75rem",
                color: "var(--text)",
                marginBottom: "0.5rem",
                lineHeight: "1.4",
              }}
            >
              {activeFeature.description}
            </div>
          )}

          <div
            style={{
              fontFamily: "var(--font-data)",
              fontSize: "0.6rem",
              letterSpacing: "0.08em",
              color: "var(--text-dim)",
              marginBottom: "0.3rem",
              textTransform: "uppercase",
            }}
          >
            ACCEPTANCE CRITERIA
          </div>
          {activeFeature.acceptanceCriteria.map((c, i) => (
            <CriterionRow key={i} criterion={c} />
          ))}

          {activeFeature.progress.length > 0 && (
            <>
              <div
                style={{
                  fontFamily: "var(--font-data)",
                  fontSize: "0.6rem",
                  letterSpacing: "0.08em",
                  color: "var(--text-dim)",
                  marginTop: "0.5rem",
                  marginBottom: "0.3rem",
                  textTransform: "uppercase",
                }}
              >
                PROGRESS
              </div>
              {activeFeature.progress.map((p, i) => (
                <CriterionRow key={i} criterion={p} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function CriterionRow({ criterion }: { criterion: { text: string; done: boolean } }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.4rem",
        padding: "0.15rem 0",
        fontFamily: "var(--font-body)",
        fontSize: "0.75rem",
        color: criterion.done ? "var(--text)" : "var(--text-dim)",
      }}
    >
      <div
        style={{
          width: "12px",
          height: "12px",
          border: criterion.done ? "1px solid var(--orange)" : "1px solid var(--border)",
          background: criterion.done ? "var(--orange)" : "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          fontSize: "0.55rem",
          color: criterion.done ? "var(--bg)" : "transparent",
        }}
      >
        {criterion.done ? "\u2713" : ""}
      </div>
      <span style={{ textDecoration: criterion.done ? "line-through" : "none" }}>
        {criterion.text}
      </span>
    </div>
  );
}
