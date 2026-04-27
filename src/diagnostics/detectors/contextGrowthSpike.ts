import type { NormalizedEvent } from "../../model/events.js";
import type { Finding } from "../../model/findings.js";
import type { RuleConfig } from "../../rules/schema.js";
import type { Detector } from "../engine.js";
import { renderTemplate } from "../engine.js";

export class ContextGrowthSpikeDetector implements Detector {
  readonly id = "context_growth_spike";

  detect(events: NormalizedEvent[], rule: RuleConfig): Finding[] {
    const threshold = Number(rule.thresholds?.["min_spike_tokens"] ?? 25000);

    // Use total context per turn: input + cache_read + cache_write
    // input_tokens alone is near-zero in cached sessions
    const totalContext = (u: typeof events[0]["usage"]) =>
      (u?.inputTokens ?? 0) +
      (u?.cacheReadInputTokens ?? 0) +
      (u?.cacheCreationInputTokens ?? 0);

    const usageEvents = events
      .filter((e) => e.kind === "assistant_usage" && e.usage !== undefined)
      .sort((a, b) => {
        const ta = a.timestamp ?? "";
        const tb = b.timestamp ?? "";
        return ta < tb ? -1 : ta > tb ? 1 : a.lineNumber - b.lineNumber;
      });

    const findings: Finding[] = [];
    for (let i = 1; i < usageEvents.length; i++) {
      const prev = usageEvents[i - 1]!;
      const curr = usageEvents[i]!;
      const prevTokens = totalContext(prev.usage);
      const currTokens = totalContext(curr.usage);
      const delta = currTokens - prevTokens;

      if (delta >= threshold) {
        // Find tool results between the previous and current usage event (by line number)
        const between = events
          .filter(
            (e) =>
              e.kind === "tool_result" &&
              e.lineNumber > prev.lineNumber &&
              e.lineNumber < curr.lineNumber
          )
          .sort((a, b) => b.estimatedTokens - a.estimatedTokens)
          .slice(0, 3);

        const evidence = [
          {
            sourceFile: curr.sourceFile,
            lineNumber: curr.lineNumber,
            timestamp: curr.timestamp,
            eventId: curr.id,
            label: "Context delta (logged)",
            value: `+${delta} tokens`,
          },
          ...between.map((e) => ({
            sourceFile: e.sourceFile,
            lineNumber: e.lineNumber,
            timestamp: e.timestamp,
            eventId: e.id,
            label: `${e.toolName ?? "tool"} result (~${e.estimatedTokens} tokens est.)`,
            value: String(
              (e.toolInput as Record<string, unknown> | undefined)?.["file_path"] ??
              (e.toolInput as Record<string, unknown> | undefined)?.["command"] ??
              (e.toolInput as Record<string, unknown> | undefined)?.["pattern"] ??
              ""
            ).slice(0, 80) || `${e.estimatedTokens} est. tokens`,
          })),
        ];

        findings.push({
          id: rule.id,
          title: rule.title,
          severity: rule.severity,
          confidence: rule.confidence,
          category: rule.category,
          loggedTokens: delta,
          evidence,
          message: renderTemplate(rule.message, { delta }),
          recommendations: rule.recommendations,
        });
      }
    }

    return findings;
  }
}
