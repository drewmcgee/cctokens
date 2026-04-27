import type { Finding } from "../model/findings.js";
import type { ScanSummary } from "./textReporter.js";

export const JSON_REPORT_VERSION = "1";

export interface JsonReport {
  version: string;
  generatedAt: string;
  summary: ScanSummary;
  findings: Finding[];
  meta: {
    totalFindings: number;
    parseErrors: number;
    totalLines: number;
  };
}

export function renderJsonReport(
  summary: ScanSummary,
  findings: Finding[],
  maxFindings?: number
): string {
  const shown = maxFindings !== undefined ? findings.slice(0, maxFindings) : findings;
  const report: JsonReport = {
    version: JSON_REPORT_VERSION,
    generatedAt: new Date().toISOString(),
    summary,
    findings: shown,
    meta: {
      totalFindings: findings.length,
      parseErrors: summary.parseErrors,
      totalLines: summary.totalLines,
    },
  };
  return JSON.stringify(report, null, 2);
}
