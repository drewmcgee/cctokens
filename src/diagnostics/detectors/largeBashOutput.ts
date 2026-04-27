import type { NormalizedEvent } from "../../model/events.js";
import type { Finding } from "../../model/findings.js";
import type { RuleConfig } from "../../rules/schema.js";
import type { Detector } from "../engine.js";
import { renderTemplate } from "../engine.js";

export class LargeBashOutputDetector implements Detector {
  readonly id = "large_bash_output";

  detect(events: NormalizedEvent[], rule: RuleConfig): Finding[] {
    const threshold = Number(rule.thresholds?.["min_estimated_tokens"] ?? 4000);
    const findings: Finding[] = [];

    const bashResults = events.filter(
      (e) => e.kind === "tool_result" && e.toolName === "Bash" && e.estimatedTokens >= threshold
    );

    for (const ev of bashResults) {
      findings.push({
        id: rule.id,
        title: rule.title,
        severity: rule.severity,
        confidence: rule.confidence,
        category: rule.category,
        estimatedTokens: ev.estimatedTokens,
        evidence: [
          {
            sourceFile: ev.sourceFile,
            lineNumber: ev.lineNumber,
            timestamp: ev.timestamp,
            eventId: ev.id,
            label: "Bash output size",
            value: `~${ev.estimatedTokens} tokens (est.)`,
          },
        ],
        message: renderTemplate(rule.message, { tokens: ev.estimatedTokens }),
        recommendations: rule.recommendations,
      });
    }

    return findings;
  }
}
