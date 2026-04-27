import type { NormalizedEvent } from "../model/events.js";
import type { Finding } from "../model/findings.js";
import { sortFindings } from "../model/findings.js";
import type { RuleConfig } from "../rules/schema.js";
import type { LoadedRule } from "../rules/loader.js";

export interface Detector {
  readonly id: string;
  detect(events: NormalizedEvent[], rule: RuleConfig): Finding[];
}

export interface DiagnosticsResult {
  findings: Finding[];
  sessionId?: string;
  sourceFile: string;
}

export function runDetectors(
  events: NormalizedEvent[],
  rules: Map<string, LoadedRule>,
  detectors: Detector[]
): Finding[] {
  const findings: Finding[] = [];

  for (const detector of detectors) {
    const loaded = rules.get(detector.id);
    if (!loaded) continue;
    try {
      const found = detector.detect(events, loaded.config);
      findings.push(...found);
    } catch {
      // detectors must not crash the pipeline
    }
  }

  return sortFindings(findings);
}

export function renderTemplate(
  template: string,
  vars: Record<string, string | number>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const val = vars[key];
    return val !== undefined ? String(val) : `{{${key}}}`;
  });
}
