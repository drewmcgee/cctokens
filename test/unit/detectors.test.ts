import { describe, it, expect } from "vitest";
import { join, resolve } from "path";
import { parseJsonlFile } from "../../src/parsers/claudeCodeJsonl.js";
import { loadRules } from "../../src/rules/loader.js";
import { runDetectors } from "../../src/diagnostics/engine.js";
import { createDefaultDetectors } from "../../src/diagnostics/detectors/index.js";
import { LargeBashOutputDetector } from "../../src/diagnostics/detectors/largeBashOutput.js";
import { RepeatedFileReadDetector } from "../../src/diagnostics/detectors/repeatedFileRead.js";
import { FullTestSuiteRerunDetector } from "../../src/diagnostics/detectors/fullTestSuiteRerun.js";
import { BroadGrepOrGlobDetector } from "../../src/diagnostics/detectors/broadGrepOrGlob.js";
import { ContextGrowthSpikeDetector } from "../../src/diagnostics/detectors/contextGrowthSpike.js";
import { ExpensiveToolLoopDetector } from "../../src/diagnostics/detectors/expensiveToolLoop.js";
import type { NormalizedEvent } from "../../src/model/events.js";

const FIXTURES = join(resolve(import.meta.dirname), "../fixtures/claude-jsonl");

async function loadFixture(name: string) {
  return parseJsonlFile(join(FIXTURES, name));
}

const rules = loadRules();

describe("LargeBashOutputDetector", () => {
  it("fires on large_bash_output fixture", async () => {
    const { events } = await loadFixture("large_bash_output.jsonl");
    const d = new LargeBashOutputDetector();
    const rule = rules.get("large_bash_output")!.config;
    const findings = d.detect(events, rule);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.estimatedTokens).toBeGreaterThan(4000);
  });

  it("silent on minimal fixture", async () => {
    const { events } = await loadFixture("minimal.jsonl");
    const d = new LargeBashOutputDetector();
    const rule = rules.get("large_bash_output")!.config;
    expect(d.detect(events, rule)).toHaveLength(0);
  });
});

describe("RepeatedFileReadDetector", () => {
  it("fires on repeated_file_read fixture", async () => {
    const { events } = await loadFixture("repeated_file_read.jsonl");
    const d = new RepeatedFileReadDetector();
    const rule = rules.get("repeated_file_read")!.config;
    const findings = d.detect(events, rule);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.evidence.length).toBeGreaterThanOrEqual(5);
  });

  it("silent on minimal fixture", async () => {
    const { events } = await loadFixture("minimal.jsonl");
    const d = new RepeatedFileReadDetector();
    const rule = rules.get("repeated_file_read")!.config;
    expect(d.detect(events, rule)).toHaveLength(0);
  });
});

describe("FullTestSuiteRerunDetector", () => {
  it("fires on full_test_suite fixture", async () => {
    const { events } = await loadFixture("full_test_suite.jsonl");
    const d = new FullTestSuiteRerunDetector();
    const rule = rules.get("full_test_suite_rerun")!.config;
    const findings = d.detect(events, rule);
    expect(findings.length).toBe(1);
    expect(findings[0]!.evidence.length).toBe(4);
  });

  it("does not treat heredoc body text as a test invocation", () => {
    const d = new FullTestSuiteRerunDetector();
    const rule = { ...rules.get("full_test_suite_rerun")!.config, thresholds: { min_count: 1 } };
    const events: NormalizedEvent[] = [
      {
        id: "use-1",
        sessionId: "sess",
        sourceFile: "/fixture.jsonl",
        lineNumber: 1,
        kind: "tool_use",
        toolName: "Bash",
        toolUseId: "tool-1",
        toolInput: {
          command: "cat > /tmp/script.py << 'PYEOF'\nprint('npm test')\nPYEOF",
        },
        rawSizeBytes: 1,
        estimatedTokens: 1,
        metadata: {},
      },
    ];

    expect(d.detect(events, rule)).toHaveLength(0);
  });

  it("does not treat targeted npm test file runs as full-suite reruns", () => {
    const d = new FullTestSuiteRerunDetector();
    const rule = { ...rules.get("full_test_suite_rerun")!.config, thresholds: { min_count: 1 } };
    const events: NormalizedEvent[] = [
      {
        id: "use-1",
        sessionId: "sess",
        sourceFile: "/fixture.jsonl",
        lineNumber: 1,
        kind: "tool_use",
        toolName: "Bash",
        toolUseId: "tool-1",
        toolInput: { command: "npm test -- test/unit/reporters.test.ts" },
        rawSizeBytes: 1,
        estimatedTokens: 1,
        metadata: {},
      },
    ];

    expect(d.detect(events, rule)).toHaveLength(0);
  });
});

describe("BroadGrepOrGlobDetector", () => {
  it("fires on broad_glob fixture", async () => {
    const { events } = await loadFixture("broad_glob.jsonl");
    const d = new BroadGrepOrGlobDetector();
    const rule = rules.get("broad_grep_or_glob")!.config;
    const findings = d.detect(events, rule);
    expect(findings.length).toBe(1);
    expect(findings[0]!.evidence.length).toBeGreaterThanOrEqual(3);
  });
});

describe("ContextGrowthSpikeDetector", () => {
  it("fires on context_growth fixture", async () => {
    const { events } = await loadFixture("context_growth.jsonl");
    const d = new ContextGrowthSpikeDetector();
    const rule = rules.get("context_growth_spike")!.config;
    const findings = d.detect(events, rule);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.loggedTokens).toBeGreaterThan(25000);
  });
});

describe("ExpensiveToolLoopDetector", () => {
  it("does not emit overlapping findings for the same tool loop region", () => {
    const d = new ExpensiveToolLoopDetector();
    const rule = rules.get("expensive_tool_loop")!.config;
    const events: NormalizedEvent[] = Array.from({ length: 12 }, (_, i) => ({
      id: `use-${i}`,
      sessionId: "sess",
      sourceFile: "/fixture.jsonl",
      lineNumber: i + 1,
      kind: "tool_use",
      toolName: "Write",
      toolUseId: `tool-${i}`,
      rawSizeBytes: 1,
      estimatedTokens: 1,
      metadata: {},
    }));

    expect(d.detect(events, rule)).toHaveLength(1);
  });
});

describe("runDetectors — multi_detector fixture", () => {
  it("surfaces multiple findings and sorts by severity", async () => {
    const { events } = await loadFixture("multi_detector.jsonl");
    const detectors = createDefaultDetectors();
    const findings = runDetectors(events, rules, detectors);
    expect(findings.length).toBeGreaterThan(1);
    // First finding should be warning or critical, not info
    expect(["warning", "critical"]).toContain(findings[0]!.severity);
  });
});

describe("Rule threshold override", () => {
  it("respects a lower min_count threshold for repeated_file_read", async () => {
    const { events } = await loadFixture("repeated_file_read.jsonl");
    const d = new RepeatedFileReadDetector();
    const overrideRule = { ...rules.get("repeated_file_read")!.config, thresholds: { min_count: 2 } };
    const findings = d.detect(events, overrideRule);
    expect(findings.length).toBeGreaterThan(0);
  });
});
