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

describe("parseJsonlFile — context_breakdown fixture", () => {
  it("emits human_turn events for user text blocks", async () => {
    const { events } = await parseJsonlFile(join(FIXTURES, "context_breakdown.jsonl"));
    const humanTurns = events.filter((e) => e.kind === "human_turn");
    // Two user text messages: compact summary + follow-up question
    expect(humanTurns.length).toBe(2);
    for (const ev of humanTurns) {
      expect(ev.estimatedTokens).toBeGreaterThan(0);
      expect(ev.role).toBe("user");
    }
  });

  it("emits assistant_turn events for text + thinking blocks", async () => {
    const { events } = await parseJsonlFile(join(FIXTURES, "context_breakdown.jsonl"));
    const assistantTurns = events.filter((e) => e.kind === "assistant_turn");
    // Two assistant messages, both have text (first also has thinking)
    expect(assistantTurns.length).toBe(2);
    for (const ev of assistantTurns) {
      expect(ev.estimatedTokens).toBeGreaterThan(0);
      expect(ev.role).toBe("assistant");
    }
  });

  it("does not duplicate assistant_turn for the same message.id", async () => {
    const { events } = await parseJsonlFile(join(FIXTURES, "context_breakdown.jsonl"));
    const turns = events.filter((e) => e.kind === "assistant_turn");
    // Unique by stripping the -turn suffix
    const ids = turns.map((e) => e.id.replace(/-turn$/, ""));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("estimates compact summary human_turn larger than short question", async () => {
    const { events } = await parseJsonlFile(join(FIXTURES, "context_breakdown.jsonl"));
    const humanTurns = events
      .filter((e) => e.kind === "human_turn")
      .sort((a, b) => a.lineNumber - b.lineNumber);
    // First human turn is the compact summary — should be larger than the short question
    expect(humanTurns[0]!.estimatedTokens).toBeGreaterThan(humanTurns[1]!.estimatedTokens);
  });

  it("emits tool_use with estimatedTokens for the Read call", async () => {
    const { events } = await parseJsonlFile(join(FIXTURES, "context_breakdown.jsonl"));
    const toolUses = events.filter((e) => e.kind === "tool_use" && e.toolName === "Read");
    expect(toolUses.length).toBe(1);
    expect(toolUses[0]!.estimatedTokens).toBeGreaterThan(0);
  });
});
