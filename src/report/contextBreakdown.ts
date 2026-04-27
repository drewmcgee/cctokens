import pc from "picocolors";
import type { NormalizedEvent } from "../model/events.js";

export interface ToolContribution {
  toolName: string;
  totalEstTokens: number;
  callCount: number;
  topCalls: Array<{ label: string; estimatedTokens: number; lineNumber: number }>;
}

export interface ContextBreakdown {
  peakContextTokens: number;  // logged total context at peak turn
  peakTurn: number;

  // Conversation history: uses logged output_tokens from all turns before peak.
  // Accurate because each turn's output becomes input on the following turn.
  // Includes assistant text, thinking, and tool invocation blocks.
  assistantHistoryTokens: number;
  assistantHistoryTurns: number;   // number of prior turns contributing
  toolInvocationCount: number;     // tool_use calls inside that history

  // Estimated from content via char÷4 heuristic (~1.5-2x imprecision on code-heavy sessions)
  humanTokens: number;
  toolResultTokens: number;

  // logged_peak − (assistantHistory + humanTokens + toolResultTokens)
  // Represents system prompt + estimation error in human/tool estimates
  residualTokens: number;

  byTool: ToolContribution[];
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

  // Assistant history: sum logged output_tokens for all turns BEFORE the peak turn.
  // These tokens are on the input side at the peak turn as conversation history.
  const priorUsage = usageEvents.filter((e) => e.lineNumber < peakTurn);
  const assistantHistoryTokens = priorUsage.reduce(
    (s, e) => s + (e.usage?.outputTokens ?? 0),
    0
  );
  const assistantHistoryTurns = priorUsage.length;

  // Count tool invocations that are part of that history
  const toolInvocationCount = events.filter(
    (e) => e.kind === "tool_use" && e.lineNumber < peakTurn
  ).length;

  const upToPeak = (e: NormalizedEvent) => e.lineNumber <= peakTurn;

  // Human conversation text (char÷4 est.)
  const humanTokens = events
    .filter((e) => e.kind === "human_turn" && upToPeak(e))
    .reduce((s, e) => s + e.estimatedTokens, 0);

  // Tool results (char÷4 est.)
  const toolResults = events.filter(
    (e) => e.kind === "tool_result" && upToPeak(e) && e.estimatedTokens > 0
  );
  const toolResultTokens = toolResults.reduce((s, e) => s + e.estimatedTokens, 0);

  const residualTokens = Math.max(
    0,
    peakContextTokens - assistantHistoryTokens - humanTokens - toolResultTokens
  );

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
    assistantHistoryTokens,
    assistantHistoryTurns,
    toolInvocationCount,
    humanTokens,
    toolResultTokens,
    residualTokens,
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
  const lines: string[] = [];

  const peak = bd.peakContextTokens;

  lines.push(bold(`Context composition at peak (~${fmtNum(peak)} tokens logged):`));
  lines.push("");

  const row = (label: string, tokens: number, tag: string, indent = "  ") => {
    const b = bar(tokens / peak);
    const p = pctStr(tokens, peak);
    lines.push(`${indent}${label.padEnd(26)} ${b} ${p}  ~${fmtNum(tokens)} ${tag}`);
  };

  // Assistant history — logged, not estimated
  row(
    "Assistant history",
    bd.assistantHistoryTokens,
    `tokens logged  (${bd.assistantHistoryTurns} turns, ${bd.toolInvocationCount} tool calls)`
  );

  // Tool results — estimated, sub-rows by tool
  const totalToolCalls = bd.byTool.reduce((s, t) => s + t.callCount, 0);
  row("Tool results", bd.toolResultTokens, `tokens est.  (${totalToolCalls} calls)`);
  for (const t of bd.byTool) {
    const b = bar(t.totalEstTokens / peak);
    const p = pctStr(t.totalEstTokens, peak);
    lines.push(dim(`      ${t.toolName.padEnd(22)} ${b} ${p}  ~${fmtNum(t.totalEstTokens)} est. (${t.callCount} calls)`));
    for (const call of t.topCalls) {
      lines.push(dim(`                               ${call.label}  ~${fmtNum(call.estimatedTokens)} est.`));
    }
  }

  // Human turns — estimated
  row("Human turns", bd.humanTokens, "tokens est.");

  // Residual
  row("Unattributed residual", bd.residualTokens, "tokens  (system prompt + est. error)");

  lines.push("");
  const attributed = bd.assistantHistoryTokens + bd.humanTokens + bd.toolResultTokens;
  const attributedPct = peak > 0 ? ((attributed / peak) * 100).toFixed(0) : "0";
  lines.push(dim(`  ${fmtNum(attributed)} / ${fmtNum(peak)} tokens attributed (${attributedPct}%); assistant history is logged, rest est. via char÷4`));

  return lines.join("\n");
}
