import type { NormalizedEvent } from "../../model/events.js";
import type { Finding } from "../../model/findings.js";
import type { RuleConfig } from "../../rules/schema.js";
import type { Detector } from "../engine.js";
import { renderTemplate } from "../engine.js";

const TEST_PATTERNS = [
  /\bpytest\b/,
  /\bnpm\s+test\b/,
  /\bpnpm\s+test\b/,
  /\byarn\s+test\b/,
  /\bmvn\s+test\b/,
  /\bgradle\s+test\b/,
  /\b\.\/gradlew\s+test\b/,
  /\bgo\s+test\s+\.\/\.\.\./,
  /\bcargo\s+test\b/,
];

function isTestCommand(command: string): boolean {
  return TEST_PATTERNS.some((re) => re.test(command));
}

export class FullTestSuiteRerunDetector implements Detector {
  readonly id = "full_test_suite_rerun";

  detect(events: NormalizedEvent[], rule: RuleConfig): Finding[] {
    const threshold = Number(rule.thresholds?.["min_count"] ?? 3);

    const testUses = events.filter((e) => {
      if (e.kind !== "tool_use" || e.toolName !== "Bash") return false;
      const input = e.toolInput as Record<string, unknown> | undefined;
      const cmd = typeof input?.["command"] === "string" ? input["command"] : "";
      return isTestCommand(cmd);
    });

    if (testUses.length < threshold) return [];

    // Pair each test use with the corresponding result to get output size
    const totalTokens = testUses.reduce((sum, e) => {
      // look up the tool_result for this tool_use
      const result = events.find(
        (r) => r.kind === "tool_result" && r.toolUseId === e.toolUseId
      );
      return sum + (result?.estimatedTokens ?? 0);
    }, 0);

    return [
      {
        id: rule.id,
        title: rule.title,
        severity: rule.severity,
        confidence: rule.confidence,
        category: rule.category,
        estimatedTokens: totalTokens,
        evidence: testUses.map((e) => {
          const input = e.toolInput as Record<string, unknown> | undefined;
          const cmd = String(input?.["command"] ?? "");
          return {
            sourceFile: e.sourceFile,
            lineNumber: e.lineNumber,
            timestamp: e.timestamp,
            eventId: e.id,
            label: "Test command",
            value: cmd.slice(0, 120),
          };
        }),
        message: renderTemplate(rule.message, {
          count: testUses.length,
          tokens: totalTokens,
        }),
        recommendations: rule.recommendations,
      },
    ];
  }
}
