import type { NormalizedEvent } from "../../model/events.js";
import type { Finding } from "../../model/findings.js";
import type { RuleConfig } from "../../rules/schema.js";
import type { Detector } from "../engine.js";
import { renderTemplate } from "../engine.js";

const COMPACTION_MARKERS = [
  /\[compact\]/i,
  /\bcompact(ed|ing)?\b/i,
  /conversation.*summar/i,
  /context.*compress/i,
];

function hasCompactionMarker(events: NormalizedEvent[]): number {
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]!;
    if (
      ev.kind === "message" &&
      ev.text &&
      COMPACTION_MARKERS.some((re) => re.test(ev.text!))
    ) {
      return i;
    }
  }
  return -1;
}

export class PostCompactionRereadDetector implements Detector {
  readonly id = "post_compaction_reread";

  detect(events: NormalizedEvent[], rule: RuleConfig): Finding[] {
    const threshold = Number(rule.thresholds?.["min_count"] ?? 3);

    const compactionIdx = hasCompactionMarker(events);
    if (compactionIdx === -1) return [];

    const postEvents = events.slice(compactionIdx);
    const readUses = postEvents.filter(
      (e) => e.kind === "tool_use" && e.toolName === "Read"
    );

    if (readUses.length < threshold) return [];

    const totalTokens = readUses.reduce((sum, e) => {
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
        evidence: readUses.slice(0, 5).map((e) => ({
          sourceFile: e.sourceFile,
          lineNumber: e.lineNumber,
          timestamp: e.timestamp,
          eventId: e.id,
          label: "Post-compaction read",
          value: String((e.metadata as Record<string, unknown>)?.["filePath"] ?? ""),
        })),
        message: renderTemplate(rule.message, {
          count: readUses.length,
          tokens: totalTokens,
        }),
        recommendations: rule.recommendations,
      },
    ];
  }
}
