import { z } from "zod";

export const RuleSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  category: z.enum([
    "large_output",
    "repeated_work",
    "search",
    "tests",
    "context_growth",
    "cache",
    "unknown",
  ]),
  severity: z.enum(["info", "warning", "critical"]),
  confidence: z.enum(["low", "medium", "high"]),
  applies_to: z
    .object({
      event_kind: z.string().optional(),
      tool_names: z.array(z.string()).optional(),
    })
    .optional(),
  thresholds: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional(),
  message: z.string(),
  recommendations: z.array(z.string()),
});

export type RuleConfig = z.infer<typeof RuleSchema>;
