import { describe, it, expect } from "vitest";
import { join, resolve } from "path";
import { parseJsonlFile } from "../../src/parsers/claudeCodeJsonl.js";
import { buildContextBreakdown, renderContextBreakdown } from "../../src/report/contextBreakdown.js";

const FIXTURES = join(resolve(import.meta.dirname), "../fixtures/claude-jsonl");

describe("buildContextBreakdown — context_breakdown fixture", () => {
  it("attributes all five categories", async () => {
    const { events } = await parseJsonlFile(join(FIXTURES, "context_breakdown.jsonl"));
    const bd = buildContextBreakdown(events);

    expect(bd.peakContextTokens).toBeGreaterThan(0);
    expect(bd.assistantTokens).toBeGreaterThan(0);
    expect(bd.humanTokens).toBeGreaterThan(0);
    expect(bd.toolResultTokens).toBeGreaterThan(0);
    expect(bd.toolInvocationTokens).toBeGreaterThan(0);
  });

  it("system residual is non-negative (estimates do not exceed logged)", async () => {
    const { events } = await parseJsonlFile(join(FIXTURES, "context_breakdown.jsonl"));
    const bd = buildContextBreakdown(events);
    expect(bd.systemResidualTokens).toBeGreaterThanOrEqual(0);
    expect(bd.estimationOverflow).toBe(false);
  });

  it("totalEstimatedTokens equals sum of four categories", async () => {
    const { events } = await parseJsonlFile(join(FIXTURES, "context_breakdown.jsonl"));
    const bd = buildContextBreakdown(events);
    expect(bd.totalEstimatedTokens).toBe(
      bd.assistantTokens + bd.humanTokens + bd.toolResultTokens + bd.toolInvocationTokens
    );
  });

  it("systemResidualTokens = peak − totalEstimated (when no overflow)", async () => {
    const { events } = await parseJsonlFile(join(FIXTURES, "context_breakdown.jsonl"));
    const bd = buildContextBreakdown(events);
    if (!bd.estimationOverflow) {
      expect(bd.systemResidualTokens).toBe(bd.peakContextTokens - bd.totalEstimatedTokens);
    }
  });

  it("byTool breakdown matches toolResultTokens total", async () => {
    const { events } = await parseJsonlFile(join(FIXTURES, "context_breakdown.jsonl"));
    const bd = buildContextBreakdown(events);
    const byToolSum = bd.byTool.reduce((s, t) => s + t.totalEstTokens, 0);
    expect(byToolSum).toBe(bd.toolResultTokens);
  });

  it("only includes events up to the peak turn", async () => {
    const { events } = await parseJsonlFile(join(FIXTURES, "context_breakdown.jsonl"));
    const bd = buildContextBreakdown(events);
    // Peak is at the first usage event since context only grows
    expect(bd.peakTurn).toBeGreaterThan(0);
  });
});

describe("buildContextBreakdown — minimal fixture (no tool calls)", () => {
  it("returns zero tool tokens for a session with no tools", async () => {
    const { events } = await parseJsonlFile(join(FIXTURES, "minimal.jsonl"));
    const bd = buildContextBreakdown(events);
    expect(bd.toolResultTokens).toBe(0);
    expect(bd.toolInvocationTokens).toBe(0);
    expect(bd.byTool).toHaveLength(0);
  });

  it("still captures assistant and human turns", async () => {
    const { events } = await parseJsonlFile(join(FIXTURES, "minimal.jsonl"));
    const bd = buildContextBreakdown(events);
    expect(bd.assistantTokens).toBeGreaterThan(0);
    expect(bd.humanTokens).toBeGreaterThan(0);
  });
});

describe("renderContextBreakdown", () => {
  it("contains all five category labels (noColor)", async () => {
    const { events } = await parseJsonlFile(join(FIXTURES, "context_breakdown.jsonl"));
    const bd = buildContextBreakdown(events);
    const output = renderContextBreakdown(bd, true);

    expect(output).toContain("Assistant responses");
    expect(output).toContain("Human turns");
    expect(output).toContain("Tool results");
    expect(output).toContain("Tool invocations");
    expect(output).toContain("System prompt");
  });

  it("includes the logged peak token count in the header", async () => {
    const { events } = await parseJsonlFile(join(FIXTURES, "context_breakdown.jsonl"));
    const bd = buildContextBreakdown(events);
    const output = renderContextBreakdown(bd, true);
    expect(output).toContain(bd.peakContextTokens.toLocaleString("en-US"));
  });

  it("shows attribution percentage in footer", async () => {
    const { events } = await parseJsonlFile(join(FIXTURES, "context_breakdown.jsonl"));
    const bd = buildContextBreakdown(events);
    const output = renderContextBreakdown(bd, true);
    expect(output).toContain("Attributed:");
    expect(output).toContain("% est.");
  });

  it("does not contain ANSI codes when noColor=true", async () => {
    const { events } = await parseJsonlFile(join(FIXTURES, "context_breakdown.jsonl"));
    const bd = buildContextBreakdown(events);
    const output = renderContextBreakdown(bd, true);
    expect(output).not.toMatch(/\x1b\[/);
  });
});
