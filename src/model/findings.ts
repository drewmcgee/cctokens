export type Severity = "info" | "warning" | "critical";
export type Confidence = "low" | "medium" | "high";
export type FindingCategory =
  | "large_output"
  | "repeated_work"
  | "search"
  | "tests"
  | "context_growth"
  | "cache"
  | "unknown";

export interface Evidence {
  sourceFile: string;
  lineNumber?: number;
  timestamp?: string;
  eventId?: string;
  label: string;
  value: string | number;
}

export interface Finding {
  id: string;
  title: string;
  severity: Severity;
  confidence: Confidence;
  category: FindingCategory;
  estimatedTokens?: number;
  evidence: Evidence[];
  message: string;
  recommendations: string[];
}

export function sortFindings(findings: Finding[]): Finding[] {
  const severityRank: Record<Severity, number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };
  const confidenceRank: Record<Confidence, number> = {
    high: 0,
    medium: 1,
    low: 2,
  };
  return [...findings].sort((a, b) => {
    const sv = severityRank[a.severity] - severityRank[b.severity];
    if (sv !== 0) return sv;
    const te = (b.estimatedTokens ?? 0) - (a.estimatedTokens ?? 0);
    if (te !== 0) return te;
    return confidenceRank[a.confidence] - confidenceRank[b.confidence];
  });
}
