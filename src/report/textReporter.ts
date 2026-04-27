import pc from "picocolors";
import type { Finding } from "../model/findings.js";
import type { TokenUsage } from "../model/events.js";

export interface ScanSummary {
  sourceFile: string;
  sessionId?: string;
  projectPath?: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  parseErrors: number;
  totalLines: number;
}

export interface ReportOptions {
  maxFindings?: number;
  noColor?: boolean;
}

function severityColor(severity: string, text: string, noColor: boolean): string {
  if (noColor) return text;
  if (severity === "critical") return pc.red(text);
  if (severity === "warning") return pc.yellow(text);
  return pc.cyan(text);
}

function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
}

export function renderTextReport(
  summary: ScanSummary,
  findings: Finding[],
  opts: ReportOptions = {}
): string {
  const { maxFindings = 10, noColor = false } = opts;
  const lines: string[] = [];
  const bold = (s: string) => (noColor ? s : pc.bold(s));
  const dim = (s: string) => (noColor ? s : pc.dim(s));

  const projectLabel = summary.projectPath ?? summary.sourceFile;
  lines.push(bold(`Session: ${projectLabel}`));
  lines.push(dim(`File:    ${summary.sourceFile}`));
  lines.push("");
  lines.push(bold("Logged tokens:"));
  lines.push(`  input:       ${fmtNum(summary.totalInputTokens)}`);
  lines.push(`  output:      ${fmtNum(summary.totalOutputTokens)}`);
  lines.push(`  cache read:  ${fmtNum(summary.totalCacheReadTokens)}`);
  lines.push(`  cache write: ${fmtNum(summary.totalCacheWriteTokens)}`);

  if (summary.parseErrors > 0) {
    lines.push(
      dim(`  (${summary.parseErrors} malformed lines skipped out of ${summary.totalLines})`)
    );
  }

  const shown = findings.slice(0, maxFindings);
  if (shown.length === 0) {
    lines.push("");
    lines.push(noColor ? "No waste patterns detected." : pc.green("No waste patterns detected."));
    return lines.join("\n");
  }

  lines.push("");
  lines.push(bold("Top context waste:"));
  lines.push("");

  for (let i = 0; i < shown.length; i++) {
    const f = shown[i]!;
    const prefix = `${i + 1}.`;
    const severityLabel = severityColor(f.severity, `[${f.severity}]`, noColor);
    lines.push(`${prefix} ${bold(f.title)} ${severityLabel}`);
    lines.push(`   ${f.message}`);

    if (f.evidence.length > 0) {
      lines.push(`   ${dim("Evidence:")} ${f.evidence.slice(0, 3).map((e) => e.value).join(", ")}`);
    }

    if (f.recommendations.length > 0) {
      lines.push(`   ${dim("Fix:")} ${f.recommendations[0]}`);
      for (const rec of f.recommendations.slice(1)) {
        lines.push(`        ${rec}`);
      }
    }
    lines.push("");
  }

  if (findings.length > maxFindings) {
    lines.push(dim(`  … and ${findings.length - maxFindings} more findings. Use --max-findings to see more.`));
  }

  return lines.join("\n");
}

export function renderUsageTable(summaries: ScanSummary[], noColor = false): string {
  const bold = (s: string) => (noColor ? s : pc.bold(s));
  const lines: string[] = [];

  const totalIn = summaries.reduce((s, r) => s + r.totalInputTokens, 0);
  const totalOut = summaries.reduce((s, r) => s + r.totalOutputTokens, 0);
  const totalCR = summaries.reduce((s, r) => s + r.totalCacheReadTokens, 0);
  const totalCW = summaries.reduce((s, r) => s + r.totalCacheWriteTokens, 0);

  lines.push(bold("Logged token totals across sessions:"));
  lines.push("");
  lines.push(`  Total sessions: ${summaries.length}`);
  lines.push(`  Input tokens:       ${fmtNum(totalIn)}`);
  lines.push(`  Output tokens:      ${fmtNum(totalOut)}`);
  lines.push(`  Cache reads:        ${fmtNum(totalCR)}`);
  lines.push(`  Cache writes:       ${fmtNum(totalCW)}`);

  return lines.join("\n");
}
