import { useState, useCallback } from "react";
import type { ReviewCategory, NormalisedReport } from "../../../lib/types/reports";
import { useReviews } from "../../../lib/services/socket";
import { renderLog } from "../../../lib/utils/logger";
import { ReviewRow } from "./ReviewRow";
import { ReviewModal } from "./ReviewModal";

interface ReviewsPaneProps {
  pid: number;
}

export function ReviewsPane({ pid }: ReviewsPaneProps) {
  const categories = useReviews(pid);
  const [selectedReport, setSelectedReport] = useState<NormalisedReport | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const handleClick = useCallback((cat: ReviewCategory) => {
    renderLog.debug("review click", cat.category);
    setSelectedReport(cat.report);
    setModalOpen(true);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          padding: "0.5rem 0.75rem",
          borderBottom: "1px solid var(--border)",
          fontFamily: "var(--font-heading)",
          fontSize: "0.8rem",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--orange)",
        }}
      >
        REVIEWS
        {categories.length > 0 && (
          <span style={{ color: "var(--text-dim)", marginLeft: "0.5rem", fontSize: "0.7rem" }}>
            {categories.length}
          </span>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {categories.length === 0 && (
          <div
            style={{
              padding: "1rem",
              fontFamily: "var(--font-body)",
              fontSize: "0.8rem",
              color: "var(--text-dim)",
              textAlign: "center",
            }}
          >
            No reviews yet
          </div>
        )}
        {categories.map((cat) => (
          <ReviewRow
            key={cat.category}
            category={cat}
            onClick={() => handleClick(cat)}
          />
        ))}
      </div>

      <ReviewModal
        report={selectedReport}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </div>
  );
}
