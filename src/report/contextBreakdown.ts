import pc from "picocolors";
import type { NormalizedEvent } from "../model/events.js";

export interface ToolContribution {
  toolName: string;
  totalEstTokens: number;
  callCount: number;
  topCalls: Array<{ label: string; estimatedTokens: number; lineNumber: number }>;
}

export interface ContextBreakdown {
  peakContextTokens: number;
  peakTurn: number;
  totalToolResultTokens: number;
  byTool: ToolContribution[];
}

export function buildContextBreakdown(events: NormalizedEvent[]): ContextBreakdown {
  // Find peak context turn (highest total context = input + cache_read + cache_write)
  const usageEvents = events
    .filter((e) => e.kind === "assistant_usage" && e.usage)
    .sort((a, b) => a.lineNumber - b.lineNumber);

  let peakContextTokens = 0;
  let peakTurn = 0;
  for (const ev of usageEvents) {
    const total =
      (ev.usage?.inputTokens ?? 0) +
      (ev.usage?.cacheReadInputTokens ?? 0) +
      (ev.usage?.cacheCreationInputTokens ?? 0);
    if (total > peakContextTokens) {
      peakContextTokens = total;
      peakTurn = ev.lineNumber;
    }
  }

  // All tool results up to peak turn
  const toolResults = events.filter(
    (e) => e.kind === "tool_result" && e.lineNumber <= peakTurn && e.estimatedTokens > 0
  );

  const totalToolResultTokens = toolResults.reduce((s, e) => s + e.estimatedTokens, 0);

  // Group by tool name
  const byToolMap = new Map<string, NormalizedEvent[]>();
  for (const ev of toolResults) {
    const name = ev.toolName ?? "unknown";
    const arr = byToolMap.get(name) ?? [];
    arr.push(ev);
    byToolMap.set(name, arr);
  }

  const byTool: ToolContribution[] = [];
  for (const [toolName, results] of byToolMap) {
    const totalEstTokens = results.reduce((s, e) => s + e.estimatedTokens, 0);
    const top = [...results]
      .sort((a, b) => b.estimatedTokens - a.estimatedTokens)
      .slice(0, 5)
      .map((e) => {
        const input = e.toolInput as Record<string, unknown> | undefined;
        const label = String(
          input?.["file_path"] ?? input?.["command"] ?? input?.["pattern"] ?? ""
        ).slice(0, 70) || `line ${e.lineNumber}`;
        return { label, estimatedTokens: e.estimatedTokens, lineNumber: e.lineNumber };
      });
    byTool.push({ toolName, totalEstTokens, callCount: results.length, topCalls: top });
  }

  byTool.sort((a, b) => b.totalEstTokens - a.totalEstTokens);

  return { peakContextTokens, peakTurn, totalToolResultTokens, byTool };
}

function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
}

function bar(fraction: number, width = 20): string {
  const filled = Math.round(fraction * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export function renderContextBreakdown(
  bd: ContextBreakdown,
  noColor = false
): string {
  const bold = (s: string) => (noColor ? s : pc.bold(s));
  const dim = (s: string) => (noColor ? s : pc.dim(s));
  const lines: string[] = [];

  lines.push(bold("Context composition at peak:"));
  lines.push(dim(`  Peak context window: ~${fmtNum(bd.peakContextTokens)} tokens (logged)`));
  lines.push(dim(`  Tool results injected: ~${fmtNum(bd.totalToolResultTokens)} tokens (est.)`));
  lines.push("");
  lines.push(bold("By tool:"));

  for (const t of bd.byTool) {
    const pct = bd.totalToolResultTokens > 0
      ? t.totalEstTokens / bd.totalToolResultTokens
      : 0;
    const pctStr = (pct * 100).toFixed(0).padStart(3) + "%";
    const b = bar(pct);
    lines.push(`  ${t.toolName.padEnd(10)} ${b} ${pctStr}  ~${fmtNum(t.totalEstTokens)} tokens est. (${t.callCount} calls)`);
    for (const call of t.topCalls) {
      lines.push(dim(`               ${call.label}  ~${fmtNum(call.estimatedTokens)} est.`));
    }
  }

  return lines.join("\n");
}
