import type { Finding } from "../model/findings.js";
import type { ScanSummary } from "./textReporter.js";

function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
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
  lines.push("## Logged Tokens");
  lines.push("");
  lines.push("| Type | Tokens |");
  lines.push("|------|--------|");
  lines.push(`| Input | ${fmtNum(summary.totalInputTokens)} |`);
  lines.push(`| Output | ${fmtNum(summary.totalOutputTokens)} |`);
  lines.push(`| Cache read | ${fmtNum(summary.totalCacheReadTokens)} |`);
  lines.push(`| Cache write | ${fmtNum(summary.totalCacheWriteTokens)} |`);

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
    if (f.estimatedTokens) {
      lines.push(`**Estimated tokens:** ~${fmtNum(f.estimatedTokens)} (est.)`);
    }
    lines.push("");
    lines.push(f.message);
    lines.push("");

    if (f.evidence.length > 0) {
      lines.push("**Evidence:**");
      for (const ev of f.evidence.slice(0, 5)) {
        lines.push(`- ${ev.label}: ${ev.value}`);
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
