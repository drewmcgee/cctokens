import type { NormalizedEvent } from "../../model/events.js";
import type { Finding } from "../../model/findings.js";
import type { RuleConfig } from "../../rules/schema.js";
import type { Detector } from "../engine.js";
import { renderTemplate } from "../engine.js";

export class LargeFileReadDetector implements Detector {
  readonly id = "large_file_read";

  detect(events: NormalizedEvent[], rule: RuleConfig): Finding[] {
    const threshold = Number(rule.thresholds?.["min_estimated_tokens"] ?? 8000);

    const findings: Finding[] = [];
    const readResults = events.filter(
      (e) => e.kind === "tool_result" && e.toolName === "Read" && e.estimatedTokens >= threshold
    );

    for (const ev of readResults) {
      const filePath =
        String((ev.toolInput as Record<string, unknown> | undefined)?.["file_path"] ?? "unknown");

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
            label: "File read size",
            value: `~${ev.estimatedTokens} tokens (est.)`,
          },
        ],
        message: renderTemplate(rule.message, {
          file: filePath,
          tokens: ev.estimatedTokens,
        }),
        recommendations: rule.recommendations,
      });
    }

    return findings;
  }
}
