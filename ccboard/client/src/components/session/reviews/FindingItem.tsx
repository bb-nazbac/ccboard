import type { Finding } from "../../../lib/types/reports";

interface FindingItemProps {
  finding: Finding;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: "var(--red)",
  high: "var(--red-dim)",
  warning: "var(--orange)",
  medium: "var(--orange-dim)",
  low: "var(--yellow-dim)",
  info: "var(--blue)",
  ok: "var(--green)",
};

function getSeverityColor(severity?: string): string {
  if (!severity) return "var(--text-dim)";
  return SEVERITY_COLORS[severity.toLowerCase()] || "var(--text-dim)";
}

export function FindingItem({ finding }: FindingItemProps) {
  const sevColor = getSeverityColor(finding.severity);

  const locationStr =
    typeof finding.location === "string"
      ? finding.location
      : finding.location
        ? `${finding.location.file}${finding.location.line ? `:${finding.location.line}` : ""}`
        : finding.file
          ? `${finding.file}${finding.line ? `:${finding.line}` : ""}`
          : null;

  const labelStyle: React.CSSProperties = {
    color: "var(--text-dim)",
    fontFamily: "var(--font-data)",
    fontSize: "0.65rem",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    marginTop: "0.3rem",
  };

  return (
    <div
      style={{
        borderLeft: `3px solid ${sevColor}`,
        padding: "0.5rem 0.75rem",
        marginBottom: "0.5rem",
        background: "rgba(0,0,0,0.15)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
        {finding.severity && (
          <span
            style={{
              fontFamily: "var(--font-data)",
              fontSize: "0.65rem",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: sevColor,
              background: "rgba(0,0,0,0.3)",
              padding: "0.1rem 0.4rem",
            }}
          >
            {finding.severity}
          </span>
        )}
        {finding.title && (
          <span
            style={{
              color: "var(--text-bright)",
              fontFamily: "var(--font-body)",
              fontSize: "0.8rem",
              fontWeight: 600,
            }}
          >
            {finding.title}
          </span>
        )}
      </div>

      {finding.description && (
        <div
          style={{
            color: "var(--text)",
            fontFamily: "var(--font-body)",
            fontSize: "0.8rem",
            lineHeight: 1.4,
            marginBottom: "0.25rem",
          }}
        >
          {finding.description}
        </div>
      )}

      {locationStr && (
        <>
          <div style={labelStyle}>LOCATION</div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.75rem",
              color: "var(--blue)",
            }}
          >
            {locationStr}
          </div>
        </>
      )}

      {finding.evidence && (
        <>
          <div style={labelStyle}>EVIDENCE</div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.7rem",
              color: "var(--text)",
              whiteSpace: "pre-wrap",
              background: "rgba(0,0,0,0.2)",
              padding: "0.3rem",
              marginTop: "0.15rem",
            }}
          >
            {finding.evidence}
          </div>
        </>
      )}

      {finding.suggestion && (
        <>
          <div style={labelStyle}>SUGGESTION</div>
          <div
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "0.75rem",
              color: "var(--green)",
              marginTop: "0.1rem",
            }}
          >
            {finding.suggestion}
          </div>
        </>
      )}

      {finding.tags && finding.tags.length > 0 && (
        <div style={{ display: "flex", gap: "0.3rem", marginTop: "0.3rem", flexWrap: "wrap" }}>
          {finding.tags.map((tag, i) => (
            <span
              key={i}
              style={{
                fontFamily: "var(--font-data)",
                fontSize: "0.6rem",
                letterSpacing: "0.06em",
                color: "var(--text-dim)",
                border: "1px solid var(--border-neutral)",
                padding: "0.05rem 0.35rem",
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
