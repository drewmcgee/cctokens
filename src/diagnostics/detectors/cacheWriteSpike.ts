import type { NormalizedEvent } from "../../model/events.js";
import type { Finding } from "../../model/findings.js";
import type { RuleConfig } from "../../rules/schema.js";
import type { Detector } from "../engine.js";
import { renderTemplate } from "../engine.js";

export class CacheWriteSpikeDetector implements Detector {
  readonly id = "cache_write_spike";

  detect(events: NormalizedEvent[], rule: RuleConfig): Finding[] {
    const threshold = Number(rule.thresholds?.["min_cache_write_tokens"] ?? 20000);

    const findings: Finding[] = [];
    const usageEvents = events.filter(
      (e) => e.kind === "assistant_usage" && (e.usage?.cacheCreationInputTokens ?? 0) >= threshold
    );

    // Sort usage events by line number to find the previous turn boundary
    const allUsage = events
      .filter((e) => e.kind === "assistant_usage")
      .sort((a, b) => a.lineNumber - b.lineNumber);

    for (const ev of usageEvents) {
      const tokens = ev.usage!.cacheCreationInputTokens!;

      // Find previous usage event to define the turn boundary
      const idx = allUsage.indexOf(ev);
      const prevLine = idx > 0 ? allUsage[idx - 1]!.lineNumber : 0;

      // Largest tool results injected between previous turn and this one
      const contributors = events
        .filter(
          (e) =>
            e.kind === "tool_result" &&
            e.lineNumber > prevLine &&
            e.lineNumber < ev.lineNumber
        )
        .sort((a, b) => b.estimatedTokens - a.estimatedTokens)
        .slice(0, 3);

      const evidence = [
        {
          sourceFile: ev.sourceFile,
          lineNumber: ev.lineNumber,
          timestamp: ev.timestamp,
          eventId: ev.id,
          label: "Cache write (logged)",
          value: `${tokens} tokens`,
        },
        ...contributors.map((c) => {
          const input = c.toolInput as Record<string, unknown> | undefined;
          const label = `${c.toolName ?? "tool"} result injected (~${c.estimatedTokens} tokens est.)`;
          const value = String(
            input?.["file_path"] ?? input?.["command"] ?? input?.["pattern"] ?? ""
          ).slice(0, 80) || `${c.estimatedTokens} est. tokens`;
          return { sourceFile: c.sourceFile, lineNumber: c.lineNumber, timestamp: c.timestamp, eventId: c.id, label, value };
        }),
      ];

      findings.push({
        id: rule.id,
        title: rule.title,
        severity: rule.severity,
        confidence: rule.confidence,
        category: rule.category,
        loggedTokens: tokens,
        evidence,
        message: renderTemplate(rule.message, { tokens }),
        recommendations: rule.recommendations,
      });
    }

    return findings;
  }
}
