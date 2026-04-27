import { describe, it, expect } from "vitest";
import { join, resolve } from "path";
import { parseJsonlFile } from "../../src/parsers/claudeCodeJsonl.js";
import { loadRules } from "../../src/rules/loader.js";
import { runDetectors } from "../../src/diagnostics/engine.js";
import { createDefaultDetectors } from "../../src/diagnostics/detectors/index.js";
import { renderTextReport } from "../../src/report/textReporter.js";
import { renderJsonReport } from "../../src/report/jsonReporter.js";
import { renderMarkdownReport } from "../../src/report/markdownReporter.js";
import type { ScanSummary } from "../../src/report/textReporter.js";

const FIXTURES = join(resolve(import.meta.dirname), "../fixtures/claude-jsonl");

function makeSummary(overrides: Partial<ScanSummary> = {}): ScanSummary {
  return {
    sourceFile: "/path/to/session.jsonl",
    sessionId: "sess-test",
    totalInputTokens: 12345,
    totalOutputTokens: 678,
    totalCacheReadTokens: 9000,
    totalCacheWriteTokens: 3000,
    totalProcessedInputTokens: 24345,
    parseErrors: 0,
    totalLines: 20,
    ...overrides,
  };
}

describe("textReporter", () => {
  it("renders token totals without ANSI codes when noColor=true", () => {
    const output = renderTextReport(makeSummary(), [], { noColor: true });
    expect(output).toContain("12,345");
    expect(output).toContain("678");
    expect(output).not.toMatch(/\x1b\[/);
  });

  it("shows no-waste message when findings is empty", () => {
    const output = renderTextReport(makeSummary(), [], { noColor: true });
    expect(output).toContain("No waste patterns detected");
  });

  it("renders findings with recommendations", async () => {
    const { events } = await parseJsonlFile(join(FIXTURES, "large_bash_output.jsonl"));
    const rules = loadRules();
    const findings = runDetectors(events, rules, createDefaultDetectors());
    const output = renderTextReport(makeSummary(), findings, { noColor: true });
    expect(output).toContain("Large Bash");
    expect(output).toMatch(/Fix:/);
  });

  it("respects maxFindings limit", () => {
    const findings = Array.from({ length: 5 }, (_, i) => ({
      id: `rule-${i}`,
      title: `Finding ${i}`,
      severity: "warning" as const,
      confidence: "high" as const,
      category: "unknown" as const,
      evidence: [],
      message: `msg ${i}`,
      recommendations: ["fix it"],
    }));
    const output = renderTextReport(makeSummary(), findings, { maxFindings: 2, noColor: true });
    expect(output).toContain("3 more findings");
  });
});

describe("jsonReporter", () => {
  it("produces valid JSON with expected top-level keys", () => {
    const output = renderJsonReport(makeSummary(), []);
    const parsed = JSON.parse(output) as Record<string, unknown>;
    expect(parsed).toHaveProperty("version", "1");
    expect(parsed).toHaveProperty("summary");
    expect(parsed).toHaveProperty("findings");
    expect(parsed).toHaveProperty("meta");
  });

  it("includes parse errors in meta", () => {
    const output = renderJsonReport(makeSummary({ parseErrors: 3 }), []);
    const parsed = JSON.parse(output) as { meta: { parseErrors: number } };
    expect(parsed.meta.parseErrors).toBe(3);
  });
});

describe("markdownReporter", () => {
  it("produces markdown with heading and table", () => {
    const output = renderMarkdownReport(makeSummary(), []);
    expect(output).toContain("# cctokens Report");
    expect(output).toContain("| Fresh input |");
    expect(output).toContain("No waste patterns detected");
  });
});
