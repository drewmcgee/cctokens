import { normalize } from "path";
import type { NormalizedEvent } from "../../model/events.js";
import type { Finding } from "../../model/findings.js";
import type { RuleConfig } from "../../rules/schema.js";
import type { Detector } from "../engine.js";
import { renderTemplate } from "../engine.js";

const BROAD_PATH_PATTERNS = new Set([".", "./", "/", ""]);
const BROAD_GLOB_PATTERNS = /^(\*\*?\/?\*?|\.\/?\*\*?\/?\*?)$/;

function isBroadSearch(input: unknown): boolean {
  if (typeof input !== "object" || input === null) return false;
  const obj = input as Record<string, unknown>;
  const path = typeof obj["path"] === "string" ? normalize(obj["path"]) : undefined;
  const pattern = typeof obj["pattern"] === "string" ? obj["pattern"] : undefined;

  if (path && BROAD_PATH_PATTERNS.has(path)) return true;
  if (pattern && BROAD_GLOB_PATTERNS.test(pattern.trim())) return true;
  return false;
}

export class BroadGrepOrGlobDetector implements Detector {
  readonly id = "broad_grep_or_glob";

  detect(events: NormalizedEvent[], rule: RuleConfig): Finding[] {
    const threshold = Number(rule.thresholds?.["min_count"] ?? 3);

    const broadSearches = events.filter(
      (e) =>
        e.kind === "tool_use" &&
        (e.toolName === "Grep" || e.toolName === "Glob") &&
        isBroadSearch(e.toolInput)
    );

    if (broadSearches.length < threshold) return [];

    const totalTokens = broadSearches.reduce((sum, e) => {
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
        evidence: broadSearches.map((e) => {
          const input = e.toolInput as Record<string, unknown> | undefined;
          return {
            sourceFile: e.sourceFile,
            lineNumber: e.lineNumber,
            timestamp: e.timestamp,
            eventId: e.id,
            label: `${e.toolName} pattern`,
            value: String(input?.["pattern"] ?? input?.["path"] ?? ""),
          };
        }),
        message: renderTemplate(rule.message, {
          count: broadSearches.length,
          tokens: totalTokens,
        }),
        recommendations: rule.recommendations,
      },
    ];
  }
}
