import { describe, it, expect } from "vitest";
import { join, resolve } from "path";
import { parseJsonlFile } from "../../src/parsers/claudeCodeJsonl.js";
import { buildContextBreakdown, renderContextBreakdown } from "../../src/report/contextBreakdown.js";

const FIXTURES = join(resolve(import.meta.dirname), "../fixtures/claude-jsonl");

describe("buildContextBreakdown — context_breakdown fixture", () => {
  it("uses logged output_tokens for assistant history", async () => {
    const { events } = await parseJsonlFile(join(FIXTURES, "context_breakdown.jsonl"));
    const bd = buildContextBreakdown(events);
    // assistantHistoryTokens comes from output_tokens of prior turns
    expect(bd.assistantHistoryTokens).toBeGreaterThan(0);
    expect(bd.assistantHistoryTurns).toBeGreaterThanOrEqual(1);
  });

  it("estimates human and tool result tokens", async () => {
    const { events } = await parseJsonlFile(join(FIXTURES, "context_breakdown.jsonl"));
    const bd = buildContextBreakdown(events);
    expect(bd.humanTokens).toBeGreaterThan(0);
    expect(bd.toolResultTokens).toBeGreaterThan(0);
  });

  it("residualTokens is non-negative", async () => {
    const { events } = await parseJsonlFile(join(FIXTURES, "context_breakdown.jsonl"));
    const bd = buildContextBreakdown(events);
    expect(bd.residualTokens).toBeGreaterThanOrEqual(0);
  });

  it("residual = peak − (assistantHistory + humanTokens + toolResultTokens)", async () => {
    const { events } = await parseJsonlFile(join(FIXTURES, "context_breakdown.jsonl"));
    const bd = buildContextBreakdown(events);
    const expected = bd.peakContextTokens - bd.assistantHistoryTokens - bd.humanTokens - bd.toolResultTokens;
    expect(bd.residualTokens).toBe(Math.max(0, expected));
  });

  it("byTool sum matches toolResultTokens", async () => {
    const { events } = await parseJsonlFile(join(FIXTURES, "context_breakdown.jsonl"));
    const bd = buildContextBreakdown(events);
    const byToolSum = bd.byTool.reduce((s, t) => s + t.totalEstTokens, 0);
    expect(byToolSum).toBe(bd.toolResultTokens);
  });

  it("counts tool invocations inside assistant history", async () => {
    const { events } = await parseJsonlFile(join(FIXTURES, "context_breakdown.jsonl"));
    const bd = buildContextBreakdown(events);
    // Fixture has one Read call; it appears before the second (peak) usage event
    expect(bd.toolInvocationCount).toBeGreaterThanOrEqual(1);
  });
});

describe("buildContextBreakdown — minimal fixture", () => {
  it("returns zero tool tokens for a session with no tools", async () => {
    const { events } = await parseJsonlFile(join(FIXTURES, "minimal.jsonl"));
    const bd = buildContextBreakdown(events);
    expect(bd.toolResultTokens).toBe(0);
    expect(bd.byTool).toHaveLength(0);
  });

  it("assistant history is zero (no prior turns before the only turn)", async () => {
    const { events } = await parseJsonlFile(join(FIXTURES, "minimal.jsonl"));
    const bd = buildContextBreakdown(events);
    // minimal.jsonl has one turn — no turns before it so history = 0
    expect(bd.assistantHistoryTokens).toBe(0);
    expect(bd.assistantHistoryTurns).toBe(0);
  });

  it("human turns are estimated", async () => {
    const { events } = await parseJsonlFile(join(FIXTURES, "minimal.jsonl"));
    const bd = buildContextBreakdown(events);
    expect(bd.humanTokens).toBeGreaterThan(0);
  });
});

describe("renderContextBreakdown", () => {
  it("contains all category labels (noColor)", async () => {
    const { events } = await parseJsonlFile(join(FIXTURES, "context_breakdown.jsonl"));
    const bd = buildContextBreakdown(events);
    const output = renderContextBreakdown(bd, true);

    expect(output).toContain("Assistant history");
    expect(output).toContain("Tool results");
    expect(output).toContain("Human turns");
    expect(output).toContain("Unattributed residual");
  });

  it("marks assistant history as logged not estimated", async () => {
    const { events } = await parseJsonlFile(join(FIXTURES, "context_breakdown.jsonl"));
    const bd = buildContextBreakdown(events);
    const output = renderContextBreakdown(bd, true);
    expect(output).toContain("logged");
  });

  it("includes the logged peak token count in the header", async () => {
    const { events } = await parseJsonlFile(join(FIXTURES, "context_breakdown.jsonl"));
    const bd = buildContextBreakdown(events);
    const output = renderContextBreakdown(bd, true);
    expect(output).toContain(bd.peakContextTokens.toLocaleString("en-US"));
  });

  it("does not contain ANSI codes when noColor=true", async () => {
    const { events } = await parseJsonlFile(join(FIXTURES, "context_breakdown.jsonl"));
    const bd = buildContextBreakdown(events);
    const output = renderContextBreakdown(bd, true);
    expect(output).not.toMatch(/\x1b\[/);
  });

  it("mentions char÷4 estimation in footer", async () => {
    const { events } = await parseJsonlFile(join(FIXTURES, "context_breakdown.jsonl"));
    const bd = buildContextBreakdown(events);
    const output = renderContextBreakdown(bd, true);
    expect(output).toContain("char÷4");
  });
});
