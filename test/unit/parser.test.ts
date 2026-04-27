import { describe, it, expect } from "vitest";
import { resolve, join } from "path";
import { parseJsonlFile } from "../../src/parsers/claudeCodeJsonl.js";

const FIXTURES = join(resolve(import.meta.dirname), "../fixtures/claude-jsonl");

describe("parseJsonlFile — minimal fixture", () => {
  it("parses assistant_usage and emits usage event", async () => {
    const result = await parseJsonlFile(join(FIXTURES, "minimal.jsonl"));
    expect(result.parseErrors).toBe(0);
    expect(result.totalLines).toBeGreaterThan(0);
    const usageEvents = result.events.filter((e) => e.kind === "assistant_usage");
    expect(usageEvents.length).toBe(1);
    expect(usageEvents[0]!.usage?.inputTokens).toBe(100);
    expect(usageEvents[0]!.usage?.outputTokens).toBe(10);
  });
});

describe("parseJsonlFile — malformed fixture", () => {
  it("counts malformed lines, does not throw", async () => {
    const result = await parseJsonlFile(join(FIXTURES, "malformed.jsonl"));
    expect(result.parseErrors).toBeGreaterThanOrEqual(2);
    expect(result.events.length).toBeGreaterThan(0);
  });
});

describe("parseJsonlFile — no_usage fixture", () => {
  it("handles missing usage fields without crash", async () => {
    const result = await parseJsonlFile(join(FIXTURES, "no_usage.jsonl"));
    expect(result.parseErrors).toBe(0);
    const usageEvents = result.events.filter((e) => e.kind === "assistant_usage");
    expect(usageEvents.length).toBe(0);
  });
});

describe("parseJsonlFile — large_bash_output fixture", () => {
  it("emits tool_use and tool_result for Bash", async () => {
    const result = await parseJsonlFile(join(FIXTURES, "large_bash_output.jsonl"));
    const uses = result.events.filter((e) => e.kind === "tool_use" && e.toolName === "Bash");
    const results = result.events.filter((e) => e.kind === "tool_result" && e.toolName === "Bash");
    expect(uses.length).toBe(1);
    expect(results.length).toBe(1);
    expect(results[0]!.estimatedTokens).toBeGreaterThan(4000);
  });
});

describe("parseJsonlFile — repeated_file_read fixture", () => {
  it("emits one tool_use per Read call with file path in metadata", async () => {
    const result = await parseJsonlFile(join(FIXTURES, "repeated_file_read.jsonl"));
    const reads = result.events.filter((e) => e.kind === "tool_use" && e.toolName === "Read");
    expect(reads.length).toBeGreaterThanOrEqual(5);
    for (const r of reads) {
      expect((r.metadata as Record<string, unknown>)["filePath"]).toBe("/proj/src/planner.py");
    }
  });
});

describe("parseJsonlFile — usage dedup", () => {
  it("does not duplicate usage events for the same message.id", async () => {
    const result = await parseJsonlFile(join(FIXTURES, "minimal.jsonl"));
    const byMsgId = new Map<string, number>();
    for (const ev of result.events.filter((e) => e.kind === "assistant_usage")) {
      const key = ev.id.replace(/-usage$/, "");
      byMsgId.set(key, (byMsgId.get(key) ?? 0) + 1);
    }
    for (const count of byMsgId.values()) {
      expect(count).toBe(1);
    }
  });
});
