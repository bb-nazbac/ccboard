import type { ReviewCategory, ReportStatus } from "../../../lib/types/reports";

interface ReviewRowProps {
  category: ReviewCategory;
  onClick: () => void;
}

const STATUS_COLORS: Record<ReportStatus, string> = {
  critical: "var(--red)",
  issue: "var(--red-dim)",
  warning: "var(--orange)",
  ok: "var(--green)",
};

const STATUS_ICONS: Record<ReportStatus, string> = {
  critical: "\u2718",
  issue: "\u26A0",
  warning: "\u26A0",
  ok: "\u2714",
};

export function ReviewRow({ category, onClick }: ReviewRowProps) {
  const color = STATUS_COLORS[category.status] || "var(--text-dim)";
  const isVerdict = category.isVerdict;

  return (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.5rem 0.75rem",
        borderLeft: `3px solid ${color}`,
        borderBottom: "1px solid var(--border-neutral)",
        cursor: "pointer",
        background: isVerdict ? "var(--orange-faint)" : "transparent",
        transition: "background 0.1s",
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.background = isVerdict
          ? "rgba(245, 124, 37, 0.18)"
          : "var(--bg-panel-hover)")
      }
      onMouseLeave={(e) =>
        (e.currentTarget.style.background = isVerdict
          ? "var(--orange-faint)"
          : "transparent")
      }
    >
      <span
        style={{
          color,
          fontSize: "0.85rem",
          minWidth: "1rem",
          textAlign: "center",
        }}
      >
        {STATUS_ICONS[category.status] || "?"}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: isVerdict ? "var(--font-heading)" : "var(--font-data)",
            fontSize: isVerdict ? "0.85rem" : "0.75rem",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: isVerdict ? "var(--orange)" : "var(--text-bright)",
            marginBottom: "0.1rem",
          }}
        >
          {category.category}
        </div>
        <div
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "0.7rem",
            color: "var(--text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {category.summary}
        </div>
      </div>

      {category.findingCount > 0 && (
        <span
          style={{
            fontFamily: "var(--font-data)",
            fontSize: "0.65rem",
            color,
            background: "rgba(0,0,0,0.3)",
            padding: "0.1rem 0.4rem",
            letterSpacing: "0.06em",
          }}
        >
          {category.findingCount}
        </span>
      )}
    </div>
  );
}
