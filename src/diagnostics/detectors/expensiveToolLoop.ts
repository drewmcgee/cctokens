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
    const findings: Finding[] = [];

    // Try cycle lengths from minCycleLength up to 4
    for (let cycleLen = minCycleLength; cycleLen <= 4; cycleLen++) {
      for (let start = 0; start <= families.length - cycleLen * minCycles; start++) {
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
          const patternStr = pattern.join(" → ");
          const involved = toolUses.slice(start, start + cycleLen * cycles);

          findings.push({
            id: rule.id,
            title: rule.title,
            severity: rule.severity,
            confidence: rule.confidence,
            category: rule.category,
            evidence: involved.slice(0, 6).map((e) => ({
              sourceFile: e.sourceFile,
              lineNumber: e.lineNumber,
              timestamp: e.timestamp,
              eventId: e.id,
              label: "Tool call",
              value: e.toolName ?? "",
            })),
            message: renderTemplate(rule.message, {
              pattern: patternStr,
              cycles,
            }),
            recommendations: rule.recommendations,
          });

          // Advance past this detected loop to avoid overlapping findings
          start = pos - 1;
          break;
        }
      }
    }

    return findings;
  }
}
