import { useState, useCallback, useRef, useEffect } from "react";
import { createFeature } from "../../../lib/services/api";
import { apiLog } from "../../../lib/utils/logger";

interface NewFeatureModalProps {
  pid: number;
  onClose: () => void;
}

export function NewFeatureModal({ pid, onClose }: NewFeatureModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [criteria, setCriteria] = useState<string[]>([""]);
  const [submitting, setSubmitting] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => titleRef.current?.focus());
  }, []);

  const addCriterion = useCallback(() => {
    setCriteria((prev) => [...prev, ""]);
  }, []);

  const removeCriterion = useCallback((idx: number) => {
    setCriteria((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const updateCriterion = useCallback((idx: number, val: string) => {
    setCriteria((prev) => prev.map((c, i) => (i === idx ? val : c)));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    try {
      await createFeature(pid, {
        slug,
        title: title.trim(),
        description: description.trim(),
        acceptanceCriteria: criteria.filter((c) => c.trim()),
      });
      apiLog.info("feature created", slug);
      onClose();
    } catch (err) {
      apiLog.error("feature create failed", err);
    } finally {
      setSubmitting(false);
    }
  }, [title, description, criteria, pid, submitting, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  return (
    <div
      onClick={onClose}
      onKeyDown={handleKeyDown}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 7000,
        background: "var(--bg-overlay)",
        backdropFilter: "blur(4px)",
        display: "flex",
        justifyContent: "center",
        paddingTop: "10vh",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "480px",
          maxHeight: "70vh",
          background: "var(--bg-panel)",
          borderLeft: "3px solid var(--orange)",
          borderTop: "1px solid var(--border)",
          borderRight: "1px solid var(--border)",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "0.6rem 0.75rem",
            borderBottom: "1px solid var(--border)",
            fontFamily: "var(--font-heading)",
            fontSize: "0.85rem",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--orange)",
          }}
        >
          NEW FEATURE
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0.75rem" }}>
          {/* Title */}
          <label
            style={{
              display: "block",
              fontFamily: "var(--font-data)",
              fontSize: "0.65rem",
              letterSpacing: "0.08em",
              color: "var(--text-dim)",
              marginBottom: "0.25rem",
              textTransform: "uppercase",
            }}
          >
            TITLE
          </label>
          <input
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Calling hours BST support"
            style={{
              width: "100%",
              background: "rgba(0,0,0,0.3)",
              border: "1px solid var(--border)",
              color: "var(--text-bright)",
              fontFamily: "var(--font-body)",
              fontSize: "0.8rem",
              padding: "0.4rem 0.6rem",
              outline: "none",
              marginBottom: "0.75rem",
              boxSizing: "border-box",
            }}
          />

          {/* Description */}
          <label
            style={{
              display: "block",
              fontFamily: "var(--font-data)",
              fontSize: "0.65rem",
              letterSpacing: "0.08em",
              color: "var(--text-dim)",
              marginBottom: "0.25rem",
              textTransform: "uppercase",
            }}
          >
            DESCRIPTION
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this feature does and why..."
            rows={3}
            style={{
              width: "100%",
              background: "rgba(0,0,0,0.3)",
              border: "1px solid var(--border)",
              color: "var(--text-bright)",
              fontFamily: "var(--font-body)",
              fontSize: "0.8rem",
              padding: "0.4rem 0.6rem",
              outline: "none",
              resize: "vertical",
              marginBottom: "0.75rem",
              boxSizing: "border-box",
            }}
          />

          {/* Acceptance Criteria */}
          <label
            style={{
              display: "block",
              fontFamily: "var(--font-data)",
              fontSize: "0.65rem",
              letterSpacing: "0.08em",
              color: "var(--text-dim)",
              marginBottom: "0.25rem",
              textTransform: "uppercase",
            }}
          >
            ACCEPTANCE CRITERIA
          </label>
          {criteria.map((c, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                gap: "0.3rem",
                marginBottom: "0.3rem",
              }}
            >
              <input
                value={c}
                onChange={(e) => updateCriterion(i, e.target.value)}
                placeholder={`Criterion ${i + 1}`}
                style={{
                  flex: 1,
                  background: "rgba(0,0,0,0.3)",
                  border: "1px solid var(--border)",
                  color: "var(--text-bright)",
                  fontFamily: "var(--font-body)",
                  fontSize: "0.8rem",
                  padding: "0.35rem 0.5rem",
                  outline: "none",
                }}
              />
              {criteria.length > 1 && (
                <button
                  onClick={() => removeCriterion(i)}
                  style={{
                    background: "none",
                    border: "1px solid var(--border)",
                    color: "var(--text-dim)",
                    fontFamily: "var(--font-data)",
                    fontSize: "0.7rem",
                    padding: "0.2rem 0.5rem",
                    cursor: "pointer",
                  }}
                >
                  X
                </button>
              )}
            </div>
          ))}
          <button
            onClick={addCriterion}
            style={{
              background: "none",
              border: "1px solid var(--border)",
              color: "var(--orange)",
              fontFamily: "var(--font-data)",
              fontSize: "0.65rem",
              letterSpacing: "0.06em",
              padding: "0.3rem 0.6rem",
              cursor: "pointer",
              marginTop: "0.2rem",
            }}
          >
            + ADD CRITERION
          </button>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "0.5rem 0.75rem",
            borderTop: "1px solid var(--border)",
            display: "flex",
            justifyContent: "flex-end",
            gap: "0.4rem",
          }}
        >
          <button
            onClick={onClose}
            style={{
              fontFamily: "var(--font-data)",
              fontSize: "0.7rem",
              letterSpacing: "0.06em",
              color: "var(--text-dim)",
              background: "none",
              border: "1px solid var(--border)",
              padding: "0.4rem 0.8rem",
              cursor: "pointer",
            }}
          >
            CANCEL
          </button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim() || submitting}
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: "0.75rem",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--orange)",
              background: "var(--orange-faint)",
              border: "1px solid var(--orange)",
              padding: "0.4rem 1rem",
              cursor: !title.trim() || submitting ? "default" : "pointer",
              opacity: !title.trim() || submitting ? 0.4 : 1,
            }}
          >
            {submitting ? "CREATING..." : "CREATE"}
          </button>
        </div>
      </div>
    </div>
  );
}
