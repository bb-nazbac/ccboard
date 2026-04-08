export type ReportStatus = "ok" | "warning" | "issue" | "critical";

export interface Finding {
  id?: string;
  severity?: string;
  title?: string;
  description?: string;
  location?: string | { file: string; line?: number };
  file?: string;
  line?: number;
  suggestion?: string;
  evidence?: string;
  confidence?: string;
  impact?: string | number;
  resolution?: string;
  discrepancy?: string;
  tags?: string[];
  _group?: string;
  source?: string;
  reason?: string;
  productImpact?: string;
  recommendation?: string;
}

export interface ReviewCategory {
  category: string;
  status: ReportStatus;
  summary: string;
  findingCount: number;
  timestamp: string | null;
  isVerdict: boolean;
  report: NormalisedReport;
}

export interface NormalisedReport {
  category: string;
  status: ReportStatus;
  summary: string;
  timestamp: string;
  findings: Finding[];
  _normalised: true;
  // Verdict-specific
  executive_summary?: string;
  council_status?: Record<string, CouncilMemberScore>;
  council_scores?: Record<string, CouncilMemberScore>;
  councilMembers?: Record<string, CouncilMemberScore>;
  conflicts_and_resolutions?: ConflictResolution[];
  conflicts?: ConflictResolution[];
  // Performance-specific
  scale_projections?: { safe_concurrent_calls?: string; bottleneck_component?: string; notes?: string };
  // Metadata
  anchor?: { commitHash: string; committedAt?: string };
  new_head?: string;
  verdict?: string;
  overall_verdict?: string;
  [key: string]: unknown;
}

export interface CouncilMemberScore {
  verdict?: string;
  rating?: string;
  score?: string;
  status?: string;
  trust_score?: string;
  top_finding?: string;
  topFinding?: string;
}

export interface ConflictResolution {
  area?: string;
  topic?: string;
  resolution?: string;
  verdict?: string;
}
