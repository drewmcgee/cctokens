import type { Finding } from "../model/findings.js";
import type { ScanSummary } from "./textReporter.js";

function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
}

function oneLine(value: string | number, maxLength = 140): string {
  const text = String(value).replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

export function renderMarkdownReport(
  summary: ScanSummary,
  findings: Finding[],
  maxFindings = 10
): string {
  const lines: string[] = [];
  const projectLabel = summary.projectPath ?? summary.sourceFile;

  lines.push(`# cctokens Report`);
  lines.push("");
  lines.push(`**Session:** ${projectLabel}`);
  lines.push(`**File:** \`${summary.sourceFile}\``);
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Logged Usage");
  lines.push("");
  lines.push("| Type | Tokens |");
  lines.push("|------|--------|");
  lines.push(`| Fresh input | ${fmtNum(summary.totalInputTokens)} |`);
  lines.push(`| Cache read input | ${fmtNum(summary.totalCacheReadTokens)} |`);
  lines.push(`| Cache creation input | ${fmtNum(summary.totalCacheWriteTokens)} |`);
  lines.push(`| Total input processed | ${fmtNum(summary.totalProcessedInputTokens)} |`);
  lines.push(`| Output | ${fmtNum(summary.totalOutputTokens)} |`);

  const shown = findings.slice(0, maxFindings);

  if (shown.length === 0) {
    lines.push("");
    lines.push("## Findings");
    lines.push("");
    lines.push("No waste patterns detected.");
    return lines.join("\n");
  }

  lines.push("");
  lines.push("## Top Context Waste");
  lines.push("");

  for (let i = 0; i < shown.length; i++) {
    const f = shown[i]!;
    lines.push(`### ${i + 1}. ${f.title}`);
    lines.push("");
    lines.push(`**Severity:** ${f.severity} | **Confidence:** ${f.confidence}`);
    if (f.loggedTokens !== undefined) {
      lines.push(`**Logged token impact:** ${fmtNum(f.loggedTokens)}`);
    } else if (f.estimatedTokens !== undefined) {
      lines.push(`**Estimated token impact:** ~${fmtNum(f.estimatedTokens)} (est.)`);
    }
    lines.push("");
    lines.push(f.message);
    lines.push("");

    if (f.evidence.length > 0) {
      lines.push("**Evidence:**");
      for (const ev of f.evidence.slice(0, 5)) {
        lines.push(`- ${ev.label}: ${oneLine(ev.value)}`);
      }
      lines.push("");
    }

    if (f.recommendations.length > 0) {
      lines.push("**Recommendations:**");
      for (const rec of f.recommendations) {
        lines.push(`- ${rec}`);
      }
      lines.push("");
    }
  }

  if (findings.length > maxFindings) {
    lines.push(`---`);
    lines.push(`_${findings.length - maxFindings} additional findings not shown._`);
  }

  return lines.join("\n");
}
