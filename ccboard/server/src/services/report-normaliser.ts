import { readdir, readFile, writeFile, stat } from "fs/promises";
import { join } from "path";
import type { NormalisedReport, Finding, ReportStatus } from "../schemas/reports.js";

/** Map raw verdict strings to canonical status values */
const VERDICT_TO_STATUS: Record<string, ReportStatus> = {
  fail: "critical",
  FAIL: "critical",
  "DO NOT SHIP": "critical",
  critical: "critical",
  CRITICAL: "critical",
  warn: "warning",
  WARN: "warning",
  warning: "warning",
  high: "issue",
  HIGH: "issue",
  medium: "warning",
  MEDIUM: "warning",
  low: "ok",
  LOW: "ok",
  pass: "ok",
  PASS: "ok",
  ok: "ok",
  OK: "ok",
  "mostly-trustworthy": "warning",
};

const VALID_STATUSES = new Set<ReportStatus>(["ok", "warning", "issue", "critical"]);

/** Normalise a raw council report into the canonical NormalisedReport shape.
 *  Handles all variant field names used by different council members. */
export function normaliseReport(raw: Record<string, unknown>): NormalisedReport {
  const report: Record<string, unknown> = { ...raw };

  // --- status ---
  const rawStatus = raw.status as string | undefined;
  if (!rawStatus || !VALID_STATUSES.has(rawStatus as ReportStatus)) {
    const v = (raw.verdict ?? raw.overall_verdict ?? raw.rating ?? raw.status) as string | undefined;
    report.status = (v ? VERDICT_TO_STATUS[v] : undefined) ?? "ok";
  }

  // --- summary (must be a string) ---
  let summary = raw.summary;
  if (!summary || typeof summary !== "string") {
    summary =
      (raw.executive_summary as string) ??
      (raw.verdict_rationale as string) ??
      ((raw.scale_projections as Record<string, unknown>)?.notes as string) ??
      null;
  }

  // Extract finding count for fallback summary
  const newFindings = asArray(raw.new_findings);
  const unchangedFindings = asArray(raw.findings_unchanged);
  const resolvedFindings = asArray(raw.findings_resolved);
  const plainFindings = asArray(raw.findings);

  if (!summary || typeof summary !== "string") {
    const parts: string[] = [];
    if (newFindings.length) parts.push(`${newFindings.length} new`);
    if (unchangedFindings.length) parts.push(`${unchangedFindings.length} unchanged`);
    if (resolvedFindings.length) parts.push(`${resolvedFindings.length} resolved`);
    if (plainFindings.length && !newFindings.length && !unchangedFindings.length)
      parts.push(`${plainFindings.length} findings`);
    summary = parts.length ? parts.join(", ") : "No findings";
  }
  report.summary = summary;

  // --- findings (merge all finding arrays into one canonical array) ---
  const merged: Finding[] = [];

  for (const f of newFindings) merged.push({ ...normaliseFinding(f), _group: "new" });
  for (const f of unchangedFindings) merged.push({ ...normaliseFinding(f), _group: "unchanged" });
  for (const f of resolvedFindings) merged.push({ ...normaliseFinding(f), _group: "resolved" });

  // Plain findings array — only include if no split arrays exist
  if (!newFindings.length && !unchangedFindings.length && !resolvedFindings.length) {
    for (const f of plainFindings) merged.push({ ...normaliseFinding(f), _group: "current" });
  }

  // Council verdict uses action_items (dict or array) instead of findings
  if (raw.category === "council-verdict") {
    const ai = raw.action_items;
    if (Array.isArray(ai)) {
      for (const f of ai) {
        merged.push({
          ...normaliseFinding(f as Record<string, unknown>),
          _group: "fix-now",
          severity: ((f as Record<string, unknown>).priority as string) ?? "critical",
        });
      }
    } else if (ai && typeof ai === "object" && !Array.isArray(ai)) {
      const bucketMap: Record<string, { group: string; severity: string }> = {
        fix_now_production_blocking: { group: "fix-now", severity: "critical" },
        fix_now: { group: "fix-now", severity: "critical" },
        fix_this_sprint: { group: "fix-sprint", severity: "high" },
        track: { group: "track", severity: "medium" },
        noted_for_later: { group: "noted", severity: "low" },
        noted: { group: "noted", severity: "low" },
      };
      for (const [bucket, items] of Object.entries(ai as Record<string, unknown>)) {
        if (!Array.isArray(items)) continue;
        const cfg = bucketMap[bucket] ?? { group: bucket, severity: "medium" };
        for (const f of items) {
          merged.push({
            ...normaliseFinding(f as Record<string, unknown>),
            _group: cfg.group,
            severity: ((f as Record<string, unknown>).severity as string) ?? cfg.severity,
          });
        }
      }
    }
  }

  report.findings = merged;

  // --- timestamp ---
  if (!report.timestamp) report.timestamp = new Date().toISOString();

  report._normalised = true;
  return report as unknown as NormalisedReport;
}

/** Normalise individual finding field names */
function normaliseFinding(raw: Record<string, unknown>): Finding {
  const f = { ...raw } as Finding;
  if (!f.description && f.detail) f.description = f.detail;
  if (!f.description && f.observation) f.description = f.observation as string;
  if (!f.suggestion && f.recommendation) f.suggestion = f.recommendation;
  return f;
}

/** Safely cast unknown to array, returning [] if not an array */
function asArray(val: unknown): Record<string, unknown>[] {
  return Array.isArray(val) ? val : [];
}

// --- File watcher: normalise reports on disk ---

const watchedDirs = new Set<string>();
const mtimeCache = new Map<string, number>();

/** Watch a .ccboard/reports directory and normalise any latest.json on change.
 *  Uses polling (fs.watch is unreliable on macOS). */
export function watchReportsDir(reportsDir: string): void {
  if (watchedDirs.has(reportsDir)) return;
  watchedDirs.add(reportsDir);

  setInterval(async () => {
    try {
      const dirs = await readdir(reportsDir);
      for (const dir of dirs) {
        const filePath = join(reportsDir, dir, "latest.json");
        try {
          const info = await stat(filePath);
          const mtime = info.mtimeMs;
          if (mtimeCache.get(filePath) === mtime) continue;
          mtimeCache.set(filePath, mtime);

          const raw = JSON.parse(await readFile(filePath, "utf-8")) as Record<string, unknown>;
          if (raw._normalised) continue;

          const normalised = normaliseReport(raw);
          await writeFile(filePath, JSON.stringify(normalised, null, 2));
          console.log(`[normaliser] normalised ${dir}/latest.json`);
        } catch {
          // File may not exist yet (e.g. test-suite/latest.json)
        }
      }
    } catch {
      // Reports dir may not exist yet
    }
  }, 5000);
}
