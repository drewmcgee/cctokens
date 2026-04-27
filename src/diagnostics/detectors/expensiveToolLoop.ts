import type { NormalizedEvent } from "../../model/events.js";
import type { Finding } from "../../model/findings.js";
import type { RuleConfig } from "../../rules/schema.js";
import type { Detector } from "../engine.js";
import { renderTemplate } from "../engine.js";

function toolFamily(toolName: string): string {
  if (toolName === "Read" || toolName === "Write" || toolName === "Edit") return "file";
  if (toolName === "Grep" || toolName === "Glob") return "search";
  if (toolName === "Bash") return "bash";
  return toolName.toLowerCase();
}

export class ExpensiveToolLoopDetector implements Detector {
  readonly id = "expensive_tool_loop";

  detect(events: NormalizedEvent[], rule: RuleConfig): Finding[] {
    const minCycleLength = Number(rule.thresholds?.["min_cycle_length"] ?? 2);
    const minCycles = Number(rule.thresholds?.["min_cycles"] ?? 3);

    const toolUses = events
      .filter((e) => e.kind === "tool_use" && e.toolName)
      .sort((a, b) => {
        const ta = a.timestamp ?? "";
        const tb = b.timestamp ?? "";
        return ta < tb ? -1 : ta > tb ? 1 : a.lineNumber - b.lineNumber;
      });

    if (toolUses.length < minCycleLength * minCycles) return [];

    const families = toolUses.map((e) => toolFamily(e.toolName!));
    const candidates: Array<{
      pattern: string[];
      cycles: number;
      involved: NormalizedEvent[];
    }> = [];

    for (let start = 0; start <= families.length - minCycleLength * minCycles;) {
      let best:
        | { cycleLen: number; cycles: number; end: number; pattern: string[] }
        | undefined;

      for (let cycleLen = minCycleLength; cycleLen <= 4; cycleLen++) {
        if (start > families.length - cycleLen * minCycles) continue;
        const pattern = families.slice(start, start + cycleLen);
        let cycles = 1;
        let pos = start + cycleLen;

        while (pos + cycleLen <= families.length) {
          const segment = families.slice(pos, pos + cycleLen);
          if (segment.every((f, i) => f === pattern[i])) {
            cycles++;
            pos += cycleLen;
          } else {
            break;
          }
        }

        if (cycles >= minCycles) {
          const candidate = { cycleLen, cycles, end: pos, pattern };
          if (!best || candidate.end - start > best.end - start) {
            best = candidate;
          }
        }
      }

      if (!best) {
        start++;
        continue;
      }

      const involved = toolUses.slice(start, best.end);

      candidates.push({ pattern: best.pattern, cycles: best.cycles, involved });

      start = best.end;
    }

    const grouped = new Map<
      string,
      { pattern: string[]; cycles: number; regions: number; evidence: NormalizedEvent[] }
    >();

    for (const candidate of candidates) {
      const key = candidate.pattern.join(" → ");
      const existing = grouped.get(key);
      if (existing) {
        existing.cycles += candidate.cycles;
        existing.regions++;
        existing.evidence.push(...candidate.involved);
      } else {
        grouped.set(key, {
          pattern: candidate.pattern,
          cycles: candidate.cycles,
          regions: 1,
          evidence: [...candidate.involved],
        });
      }
    }

    return Array.from(grouped.values()).map((group) => {
      const patternStr = group.pattern.join(" → ");
      return {
        id: rule.id,
        title: rule.title,
        severity: rule.severity,
        confidence: rule.confidence,
        category: rule.category,
        evidence: group.evidence.slice(0, 6).map((e) => ({
          sourceFile: e.sourceFile,
          lineNumber: e.lineNumber,
          timestamp: e.timestamp,
          eventId: e.id,
          label: "Tool call",
          value: e.toolName ?? "",
        })),
        message: renderTemplate(rule.message, {
          pattern: patternStr,
          cycles: group.cycles,
          regions: group.regions,
        }),
        recommendations: rule.recommendations,
      };
    });
  }
}
