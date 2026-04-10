import { useMemo } from "react";
import type { NormalisedReport, Finding } from "../../../lib/types/reports";
import { Modal } from "../../shared/Modal";
import { FindingItem } from "./FindingItem";

interface ReviewModalProps {
  report: NormalisedReport | null;
  open: boolean;
  onClose: () => void;
}

export function ReviewModal({ report, open, onClose }: ReviewModalProps) {
  const isVerdict = report?.category === "verdict" || report?.category === "council-verdict";

  const councilScores = report?.council_scores || report?.council_status || report?.councilMembers;

  const conflicts = report?.conflicts_and_resolutions || report?.conflicts || [];

  const grouped = useMemo(() => {
    if (!report?.findings) return {};
    const groups: Record<string, Finding[]> = {};
    for (const f of report.findings) {
      const g = f._group || "Findings";
      if (!groups[g]) groups[g] = [];
      groups[g].push(f);
    }
    return groups;
  }, [report?.findings]);

  if (!report) return null;

  const sectionTitle: React.CSSProperties = {
    fontFamily: "var(--font-heading)",
    fontSize: "0.85rem",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "var(--orange)",
    marginTop: "1rem",
    marginBottom: "0.5rem",
    borderBottom: "1px solid var(--border)",
    paddingBottom: "0.25rem",
  };

  return (
    <Modal open={open} onClose={onClose} title={(report.category ?? "REPORT").toUpperCase()}>
      {/* Summary */}
      <div
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "0.85rem",
          color: "var(--text-bright)",
          marginBottom: "0.75rem",
          lineHeight: 1.5,
        }}
      >
        {report.summary}
      </div>

      {/* Verdict: executive summary */}
      {isVerdict && report.executive_summary && (
        <>
          <div style={sectionTitle}>EXECUTIVE SUMMARY</div>
          <div
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "0.8rem",
              color: "var(--text)",
              lineHeight: 1.5,
              padding: "0.5rem",
              background: "rgba(0,0,0,0.15)",
              borderLeft: "3px solid var(--orange)",
            }}
          >
            {report.executive_summary}
          </div>
        </>
      )}

      {/* Council scores grid */}
      {isVerdict && councilScores && Object.keys(councilScores).length > 0 && (
        <>
          <div style={sectionTitle}>COUNCIL SCORES</div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: "0.5rem",
            }}
          >
            {Object.entries(councilScores).map(([member, score]) => (
              <div
                key={member}
                style={{
                  padding: "0.5rem",
                  background: "rgba(0,0,0,0.2)",
                  borderLeft: "2px solid var(--border)",
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-data)",
                    fontSize: "0.7rem",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: "var(--text-bright)",
                    marginBottom: "0.2rem",
                  }}
                >
                  {member}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.7rem",
                    color: "var(--text)",
                  }}
                >
                  {score.verdict || score.rating || score.status || score.score || "N/A"}
                </div>
                {(score.top_finding || score.topFinding) && (
                  <div
                    style={{
                      fontFamily: "var(--font-body)",
                      fontSize: "0.65rem",
                      color: "var(--text-dim)",
                      marginTop: "0.15rem",
                    }}
                  >
                    {score.top_finding || score.topFinding}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Grouped findings */}
      {Object.entries(grouped).map(([group, findings]) => (
        <div key={group}>
          <div style={sectionTitle}>{group.toUpperCase()}</div>
          {findings.map((f, i) => (
            <FindingItem key={f.id || i} finding={f} />
          ))}
        </div>
      ))}

      {/* Conflicts */}
      {isVerdict && conflicts.length > 0 && (
        <>
          <div style={sectionTitle}>CONFLICTS &amp; RESOLUTIONS</div>
          {conflicts.map((c, i) => (
            <div
              key={i}
              style={{
                padding: "0.5rem",
                marginBottom: "0.4rem",
                background: "rgba(0,0,0,0.15)",
                borderLeft: "3px solid var(--yellow)",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-data)",
                  fontSize: "0.7rem",
                  color: "var(--yellow)",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                }}
              >
                {c.area || c.topic || "Conflict"}
              </div>
              {c.resolution && (
                <div
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: "0.75rem",
                    color: "var(--text)",
                    marginTop: "0.2rem",
                  }}
                >
                  {c.resolution}
                </div>
              )}
            </div>
          ))}
        </>
      )}

      {/* Metadata */}
      {report.anchor && (
        <div
          style={{
            marginTop: "1rem",
            fontFamily: "var(--font-mono)",
            fontSize: "0.65rem",
            color: "var(--text-dim)",
          }}
        >
          ANCHOR: {report.anchor.commitHash?.slice(0, 8)}
          {report.anchor.committedAt && ` @ ${report.anchor.committedAt}`}
        </div>
      )}
    </Modal>
  );
}
