import pc from "picocolors";
import type { NormalizedEvent } from "../model/events.js";

export interface ToolContribution {
  toolName: string;
  totalEstTokens: number;
  callCount: number;
  topCalls: Array<{ label: string; estimatedTokens: number; lineNumber: number }>;
}

export interface ContextBreakdown {
  peakContextTokens: number;   // logged total context at peak turn
  peakTurn: number;

  // Estimated components (all events up to peak turn)
  assistantTokens: number;      // assistant text + thinking blocks
  humanTokens: number;          // human conversation text (incl. compact summaries)
  toolResultTokens: number;     // tool results injected into context
  toolInvocationTokens: number; // tool_use call blocks (name + input)

  // logged_peak − sum(above); represents system prompt + estimation error
  systemResidualTokens: number;
  // true when estimates exceed logged total (char÷4 can over-count compressed text)
  estimationOverflow: boolean;

  totalEstimatedTokens: number; // sum of the four estimated categories

  byTool: ToolContribution[];   // tool results broken down by tool name
}

export function buildContextBreakdown(events: NormalizedEvent[]): ContextBreakdown {
  // Find the turn with the highest total context (input + cache_read + cache_write)
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

  const upToPeak = (e: NormalizedEvent) => e.lineNumber <= peakTurn;

  // Assistant text + thinking
  const assistantTokens = events
    .filter((e) => e.kind === "assistant_turn" && upToPeak(e))
    .reduce((s, e) => s + e.estimatedTokens, 0);

  // Human conversation (incl. compact summaries)
  const humanTokens = events
    .filter((e) => e.kind === "human_turn" && upToPeak(e))
    .reduce((s, e) => s + e.estimatedTokens, 0);

  // Tool results
  const toolResults = events.filter(
    (e) => e.kind === "tool_result" && upToPeak(e) && e.estimatedTokens > 0
  );
  const toolResultTokens = toolResults.reduce((s, e) => s + e.estimatedTokens, 0);

  // Tool invocations (the tool_use call blocks — name + input JSON)
  const toolInvocationTokens = events
    .filter((e) => e.kind === "tool_use" && upToPeak(e))
    .reduce((s, e) => s + e.estimatedTokens, 0);

  const totalEstimatedTokens =
    assistantTokens + humanTokens + toolResultTokens + toolInvocationTokens;

  const rawResidual = peakContextTokens - totalEstimatedTokens;
  const systemResidualTokens = Math.max(0, rawResidual);
  const estimationOverflow = rawResidual < 0;

  // Group tool results by tool name
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

  return {
    peakContextTokens,
    peakTurn,
    assistantTokens,
    humanTokens,
    toolResultTokens,
    toolInvocationTokens,
    systemResidualTokens,
    estimationOverflow,
    totalEstimatedTokens,
    byTool,
  };
}

function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
}

function bar(fraction: number, width = 20): string {
  const filled = Math.round(Math.max(0, Math.min(1, fraction)) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function pctStr(n: number, total: number): string {
  if (total === 0) return "  0%";
  return ((n / total) * 100).toFixed(0).padStart(3) + "%";
}

export function renderContextBreakdown(
  bd: ContextBreakdown,
  noColor = false
): string {
  const bold = (s: string) => (noColor ? s : pc.bold(s));
  const dim = (s: string) => (noColor ? s : pc.dim(s));
  const yellow = (s: string) => (noColor ? s : pc.yellow(s));
  const lines: string[] = [];

  const peak = bd.peakContextTokens;

  lines.push(bold(`Context composition at peak (~${fmtNum(peak)} tokens logged):`));
  lines.push("");

  const row = (
    label: string,
    tokens: number,
    suffix: string,
    indent = ""
  ) => {
    const b = bar(tokens / peak);
    const p = pctStr(tokens, peak);
    lines.push(`${indent}  ${label.padEnd(22)} ${b} ${p}  ~${fmtNum(tokens)} ${suffix}`);
  };

  row("Assistant responses", bd.assistantTokens, "tokens est.");
  row("Human turns", bd.humanTokens, "tokens est.");

  // Tool results row + per-tool sub-rows
  const totalCalls = bd.byTool.reduce((s, t) => s + t.callCount, 0);
  row("Tool results", bd.toolResultTokens, `tokens est. (${totalCalls} calls)`);
  for (const t of bd.byTool) {
    const b = bar(t.totalEstTokens / peak);
    const p = pctStr(t.totalEstTokens, peak);
    lines.push(dim(`      ${t.toolName.padEnd(18)} ${b} ${p}  ~${fmtNum(t.totalEstTokens)} est. (${t.callCount} calls)`));
    for (const call of t.topCalls) {
      lines.push(dim(`                           ${call.label}  ~${fmtNum(call.estimatedTokens)} est.`));
    }
  }

  row("Tool invocations", bd.toolInvocationTokens, "tokens est.");

  // System + residual — the unobservable constant (system prompt) plus estimation error
  if (bd.estimationOverflow) {
    lines.push(yellow(`    System prompt           (estimates exceeded logged total by ~${fmtNum(bd.totalEstimatedTokens - peak)} tokens)`));
  } else {
    row("System prompt (est.)", bd.systemResidualTokens, "tokens (logged − est.)");
  }

  lines.push("");
  const attributedPct = peak > 0 ? ((bd.totalEstimatedTokens / peak) * 100).toFixed(0) : "0";
  lines.push(dim(`  Attributed: ~${fmtNum(bd.totalEstimatedTokens)} / ${fmtNum(peak)} logged tokens (${attributedPct}% est.)`));
  lines.push(dim(`  System prompt = logged peak − attributed; includes estimation error.`));

  return lines.join("\n");
}
