import type { NormalizedEvent } from "../../model/events.js";
import type { Finding } from "../../model/findings.js";
import type { RuleConfig } from "../../rules/schema.js";
import type { Detector } from "../engine.js";
import { renderTemplate } from "../engine.js";

export class LongSessionDragDetector implements Detector {
  readonly id = "long_session_drag";

  detect(events: NormalizedEvent[], rule: RuleConfig): Finding[] {
    const minTurns = Number(rule.thresholds?.["min_turns"] ?? 40);
    const minInputTokens = Number(rule.thresholds?.["min_input_tokens"] ?? 100000);

    const totalContext = (u: typeof events[0]["usage"]) =>
      (u?.inputTokens ?? 0) +
      (u?.cacheReadInputTokens ?? 0) +
      (u?.cacheCreationInputTokens ?? 0);

    const usageEvents = events.filter(
      (e) => e.kind === "assistant_usage" && e.usage !== undefined
    );

    if (usageEvents.length < minTurns) return [];

    const maxInputTokens = usageEvents.reduce(
      (max, e) => Math.max(max, totalContext(e.usage)),
      0
    );

    if (maxInputTokens < minInputTokens) return [];

    const lastUsage = usageEvents[usageEvents.length - 1]!;

    return [
      {
        id: rule.id,
        title: rule.title,
        severity: rule.severity,
        confidence: rule.confidence,
        category: rule.category,
        estimatedTokens: maxInputTokens,
        evidence: [
          {
            sourceFile: lastUsage.sourceFile,
            lineNumber: lastUsage.lineNumber,
            timestamp: lastUsage.timestamp,
            eventId: lastUsage.id,
            label: "Assistant turns",
            value: usageEvents.length,
          },
          {
            sourceFile: lastUsage.sourceFile,
            lineNumber: lastUsage.lineNumber,
            timestamp: lastUsage.timestamp,
            eventId: lastUsage.id,
            label: "Peak input tokens (logged)",
            value: maxInputTokens,
          },
        ],
        message: renderTemplate(rule.message, {
          turns: usageEvents.length,
          tokens: maxInputTokens,
        }),
        recommendations: rule.recommendations,
      },
    ];
  }
}
