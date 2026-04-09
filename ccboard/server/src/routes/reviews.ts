import { Router } from "express";
import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { getSessions } from "../services/session-reader.js";
import { backfillPairing } from "../services/pairing.js";
import { normaliseReport, watchReportsDir } from "../services/report-normaliser.js";
import type { NormalisedReport } from "../schemas/reports.js";

const router = Router();

interface ReviewCategoryItem {
  category: string;
  status: string;
  summary: string;
  findingCount: number;
  timestamp: string | null;
  isVerdict: boolean;
  report: NormalisedReport;
}

// GET /api/sessions/:pid/supervisor/reviews — read .ccboard/ review files
router.get("/:pid/supervisor/reviews", async (req, res) => {
  const pid = Number(req.params.pid);
  const sessions = await getSessions();
  const session = sessions.find((s) => s.pid === pid);
  if (!session) { res.status(404).json({ error: "session not found" }); return; }

  // Ensure pairing metadata is up to date before serving reviews
  void backfillPairing(session.cwd);

  const reportsDir = join(session.cwd, ".ccboard", "reports");

  // Start watching this reports dir if not already
  watchReportsDir(reportsDir);

  const categories: ReviewCategoryItem[] = [];
  try {
    const dirs = await readdir(reportsDir);
    for (const dir of dirs) {
      try {
        const raw = JSON.parse(
          await readFile(join(reportsDir, dir, "latest.json"), "utf-8"),
        ) as Record<string, unknown>;
        // Normalise on read if watcher hasn't caught it yet
        const report: NormalisedReport = raw._normalised
          ? (raw as unknown as NormalisedReport)
          : normaliseReport(raw);

        categories.push({
          category: (report.category as string) || dir,
          status: report.status,
          summary: report.summary,
          findingCount: Array.isArray(report.findings) ? report.findings.length : 0,
          timestamp: report.timestamp || null,
          isVerdict: dir === "council-verdict" || report.category === "council-verdict",
          report,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "unknown";
        console.error(`[reviews] failed to read ${dir}:`, msg);
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[reviews] failed to read reports dir:", msg);
  }

  // Sort: verdict first, then alphabetical
  categories.sort((a, b) => {
    if (a.isVerdict && !b.isVerdict) return -1;
    if (!a.isVerdict && b.isVerdict) return 1;
    return (a.category || "").localeCompare(b.category || "");
  });

  res.json({ categories });
});

export default router;
