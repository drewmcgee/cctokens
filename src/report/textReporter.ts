import pc from "picocolors";
import type { Finding } from "../model/findings.js";

export interface ScanSummary {
  sourceFile: string;
  sessionId?: string;
  projectPath?: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalProcessedInputTokens: number;
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

function oneLine(value: string | number, maxLength = 120): string {
  const text = String(value).replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
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
  lines.push(bold("Logged usage:"));
  lines.push(`  fresh input:           ${fmtNum(summary.totalInputTokens)}`);
  lines.push(`  cache read input:      ${fmtNum(summary.totalCacheReadTokens)}`);
  lines.push(`  cache creation input:  ${fmtNum(summary.totalCacheWriteTokens)}`);
  lines.push(`  total input processed: ${fmtNum(summary.totalProcessedInputTokens)}`);
  lines.push(`  output:                ${fmtNum(summary.totalOutputTokens)}`);

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
    if (f.loggedTokens !== undefined) {
      lines.push(`   ${dim("Impact:")} ${fmtNum(f.loggedTokens)} logged tokens`);
    } else if (f.estimatedTokens !== undefined) {
      lines.push(`   ${dim("Impact:")} ~${fmtNum(f.estimatedTokens)} tokens est.`);
    }

    if (f.evidence.length > 0) {
      const evidence = f.evidence
        .slice(0, 3)
        .map((e) => `${e.label}: ${oneLine(e.value)}`)
        .join("; ");
      lines.push(`   ${dim("Evidence:")} ${evidence}`);
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
  const totalProcessed = summaries.reduce((s, r) => s + r.totalProcessedInputTokens, 0);

  lines.push(bold("Logged token totals across sessions:"));
  lines.push("");
  lines.push(`  Total sessions: ${summaries.length}`);
  lines.push(`  Fresh input:           ${fmtNum(totalIn)}`);
  lines.push(`  Cache read input:      ${fmtNum(totalCR)}`);
  lines.push(`  Cache creation input:  ${fmtNum(totalCW)}`);
  lines.push(`  Total input processed: ${fmtNum(totalProcessed)}`);
  lines.push(`  Output tokens:         ${fmtNum(totalOut)}`);

  return lines.join("\n");
}
