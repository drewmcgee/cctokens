export type EventKind =
  | "message"
  | "assistant_usage"
  | "tool_use"
  | "tool_result"
  | "human_turn"
  | "assistant_turn"
  | "unknown";

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

export interface NormalizedEvent {
  id: string;
  sessionId: string;
  projectPath?: string;
  sourceFile: string;
  lineNumber: number;
  timestamp?: string;
  kind: EventKind;
  role?: "user" | "assistant" | "system";
  model?: string;
  toolName?: string;
  toolInput?: unknown;
  toolUseId?: string;
  text?: string;
  rawSizeBytes: number;
  estimatedTokens: number;
  usage?: TokenUsage;
  metadata: Record<string, unknown>;
}

export interface ParseResult {
  events: NormalizedEvent[];
  parseErrors: number;
  totalLines: number;
}
