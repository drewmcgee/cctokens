import { basename } from "path";
import type { NormalizedEvent } from "../../model/events.js";
import type { Finding } from "../../model/findings.js";
import type { RuleConfig } from "../../rules/schema.js";
import type { Detector } from "../engine.js";
import { renderTemplate } from "../engine.js";

function filePathFromEvent(ev: NormalizedEvent): string {
  const input = ev.toolInput as Record<string, unknown> | undefined;
  return String(input?.["file_path"] ?? input?.["path"] ?? (ev.metadata as Record<string, unknown>)?.["filePath"] ?? "unknown");
}

// Split a list of reads into runs of consecutive reads with no Write/Edit in between.
// A Write or Edit to the same file resets the run — that's not waste.
function unchangedRuns(filePath: string, reads: NormalizedEvent[], allEvents: NormalizedEvent[]): NormalizedEvent[][] {
  const writeLines = new Set(
    allEvents
      .filter((e) => {
        if (e.kind !== "tool_use") return false;
        if (e.toolName !== "Write" && e.toolName !== "Edit") return false;
        return filePathFromEvent(e) === filePath;
      })
      .map((e) => e.lineNumber)
  );

  const sorted = [...reads].sort((a, b) => a.lineNumber - b.lineNumber);
  const runs: NormalizedEvent[][] = [];
  let current: NormalizedEvent[] = [];

  for (const read of sorted) {
    // Check if any write to this file occurred between the last read and this one
    const prevLine = current[current.length - 1]?.lineNumber ?? -1;
    const writeInBetween = [...writeLines].some((l) => l > prevLine && l < read.lineNumber);
    if (writeInBetween && current.length > 0) {
      runs.push(current);
      current = [];
    }
    current.push(read);
  }
  if (current.length > 0) runs.push(current);

  return runs;
}

export class RepeatedFileReadDetector implements Detector {
  readonly id = "repeated_file_read";

  detect(events: NormalizedEvent[], rule: RuleConfig): Finding[] {
    const threshold = Number(rule.thresholds?.["min_count"] ?? 5);

    const readUses = events.filter(
      (e) => e.kind === "tool_use" && e.toolName === "Read"
    );

    const byFile = new Map<string, NormalizedEvent[]>();
    for (const ev of readUses) {
      const fp = filePathFromEvent(ev);
      const existing = byFile.get(fp) ?? [];
      existing.push(ev);
      byFile.set(fp, existing);
    }

    const findings: Finding[] = [];
    for (const [filePath, reads] of byFile) {
      const runs = unchangedRuns(filePath, reads, events);

      for (const run of runs) {
        if (run.length < threshold) continue;

        const totalTokens = run.reduce((sum, e) => {
          const result = events.find(
            (r) => r.kind === "tool_result" && r.toolUseId === e.toolUseId
          );
          return sum + (result?.estimatedTokens ?? 0);
        }, 0);

        const base = basename(filePath);
        findings.push({
          id: rule.id,
          title: rule.title,
          severity: rule.severity,
          confidence: rule.confidence,
          category: rule.category,
          estimatedTokens: totalTokens,
          evidence: run.map((e) => ({
            sourceFile: e.sourceFile,
            lineNumber: e.lineNumber,
            timestamp: e.timestamp,
            eventId: e.id,
            label: "Read (unchanged)",
            value: filePath,
          })),
          message: renderTemplate(rule.message, {
            file: filePath,
            count: run.length,
            tokens: totalTokens,
            basename: base,
          }),
          recommendations: rule.recommendations.map((r) =>
            renderTemplate(r, { file: filePath, basename: base })
          ),
        });
      }
    }

    return findings;
  }
}
