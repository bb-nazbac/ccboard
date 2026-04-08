import { z } from "zod";

// --- Finding: the universal shape every finding gets normalised to ---

export const FindingSeveritySchema = z.enum(["low", "medium", "high", "critical"]);
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;

export const FindingGroupSchema = z.enum([
  "new",
  "unchanged",
  "resolved",
  "current",
  "fix-now",
  "fix-sprint",
  "track",
  "noted",
]);
export type FindingGroup = z.infer<typeof FindingGroupSchema>;

export const FindingSchema = z.object({
  id: z.string().optional(),
  severity: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  location: z.union([z.string(), z.object({ file: z.string(), line: z.number().optional() })]).optional(),
  file: z.string().optional(),
  line: z.number().optional(),
  suggestion: z.string().optional(),
  evidence: z.string().optional(),
  confidence: z.string().optional(),
  impact: z.union([z.string(), z.number()]).optional(),
  resolution: z.string().optional(),
  discrepancy: z.string().optional(),
  tags: z.array(z.string()).optional(),
  // Set by normaliser
  _group: z.string().optional(),
  // Passthrough for category-specific fields
  source: z.string().optional(),
  reason: z.string().optional(),
  productImpact: z.string().optional(),
  recommendation: z.string().optional(),
  detail: z.string().optional(),
  observation: z.string().optional(),
  status: z.string().optional(),
}).passthrough();
export type Finding = z.infer<typeof FindingSchema>;

// --- Report status: the 4 canonical levels ---

export const ReportStatusSchema = z.enum(["ok", "warning", "issue", "critical"]);
export type ReportStatus = z.infer<typeof ReportStatusSchema>;

// --- Normalised report: the canonical form every report must have after normalisation ---

export const NormalisedReportSchema = z.object({
  category: z.string(),
  status: ReportStatusSchema,
  summary: z.string(),
  timestamp: z.string(),
  anchor: z.object({
    commitHash: z.string(),
    committedAt: z.string().optional(),
  }).optional(),
  findings: z.array(FindingSchema),
  _normalised: z.literal(true),
}).passthrough(); // Allow extra category-specific fields
export type NormalisedReport = z.infer<typeof NormalisedReportSchema>;

// --- Review category (what the API returns to the frontend) ---

export const ReviewCategorySchema = z.object({
  category: z.string(),
  status: ReportStatusSchema,
  summary: z.string(),
  findingCount: z.number(),
  timestamp: z.string().nullable(),
  isVerdict: z.boolean(),
  report: z.record(z.unknown()),
});
export type ReviewCategory = z.infer<typeof ReviewCategorySchema>;

export const ReviewsResponseSchema = z.object({
  categories: z.array(ReviewCategorySchema),
});
export type ReviewsResponse = z.infer<typeof ReviewsResponseSchema>;

// --- Verdict-specific fields (council-verdict reports have extra structure) ---

export const CouncilMemberScoreSchema = z.object({
  verdict: z.string().optional(),
  rating: z.string().optional(),
  score: z.string().optional(),
  status: z.string().optional(),
  trust_score: z.string().optional(),
  top_finding: z.string().optional(),
}).passthrough();
export type CouncilMemberScore = z.infer<typeof CouncilMemberScoreSchema>;
