import { createReadStream } from "fs";
import { createInterface } from "readline";
import { randomUUID } from "crypto";
import type { NormalizedEvent, ParseResult, TokenUsage } from "../model/events.js";
import type { TokenEstimator } from "../estimators/charDivFour.js";
import { defaultEstimator } from "../estimators/charDivFour.js";

interface RawToolUse {
  id: string;
  name: string;
  input: unknown;
}

interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface RawMessage {
  id?: string;
  model?: string;
  role?: string;
  content?: unknown[];
  usage?: RawUsage;
}

interface RawEvent {
  type?: string;
  uuid?: string;
  sessionId?: string;
  cwd?: string;
  timestamp?: string;
  message?: RawMessage;
  toolUseResult?: {
    stdout?: string;
    stderr?: string;
  };
  sourceToolAssistantUUID?: string;
  isSidechain?: boolean;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (typeof block === "object" && block !== null) {
          const b = block as Record<string, unknown>;
          if (typeof b["text"] === "string") return b["text"];
        }
        return "";
      })
      .join("");
  }
  return "";
}

function extractFilePath(toolInput: unknown): string | undefined {
  if (typeof toolInput !== "object" || toolInput === null) return undefined;
  const obj = toolInput as Record<string, unknown>;
  if (typeof obj["file_path"] === "string") return obj["file_path"];
  if (typeof obj["path"] === "string") return obj["path"];
  return undefined;
}

function normalizeUsage(raw: RawUsage | undefined): TokenUsage | undefined {
  if (!raw) return undefined;
  const u: TokenUsage = {};
  if (typeof raw.input_tokens === "number") u.inputTokens = raw.input_tokens;
  if (typeof raw.output_tokens === "number") u.outputTokens = raw.output_tokens;
  if (typeof raw.cache_creation_input_tokens === "number")
    u.cacheCreationInputTokens = raw.cache_creation_input_tokens;
  if (typeof raw.cache_read_input_tokens === "number")
    u.cacheReadInputTokens = raw.cache_read_input_tokens;
  return Object.keys(u).length ? u : undefined;
}

function serializeSize(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return 0;
  }
}

export interface ParseOptions {
  estimator?: TokenEstimator;
  startOffset?: number;
  startLine?: number;
}

export async function parseJsonlFile(
  filePath: string,
  options: ParseOptions = {}
): Promise<ParseResult> {
  const estimator = options.estimator ?? defaultEstimator;
  const startLine = options.startLine ?? 0;

  const events: NormalizedEvent[] = [];
  let parseErrors = 0;
  let totalLines = 0;

  // tool_use_id -> {name, input} for cross-referencing tool results
  const toolCallMap = new Map<string, { name: string; input: unknown }>();
  // message.id dedup for usage (same message can appear in multiple streaming events)
  const seenMessageIds = new Set<string>();

  const fileStream = createReadStream(filePath, {
    start: options.startOffset ?? 0,
    encoding: "utf8",
  });

  const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    totalLines++;
    const lineNumber = startLine + totalLines;
    const trimmed = line.trim();
    if (!trimmed) continue;

    let raw: RawEvent;
    try {
      raw = JSON.parse(trimmed) as RawEvent;
    } catch {
      parseErrors++;
      continue;
    }

    if (typeof raw !== "object" || raw === null) {
      parseErrors++;
      continue;
    }

    const sessionId = raw.sessionId ?? "unknown";
    const projectPath = raw.cwd;
    const timestamp = raw.timestamp;
    const eventType = raw.type ?? "unknown";

    if (eventType === "assistant" && raw.message) {
      const msg = raw.message;
      const model = msg.model;
      const msgId = msg.id;

      // Emit usage event (deduplicated by message.id)
      const usage = normalizeUsage(msg.usage);
      if (usage && msgId && !seenMessageIds.has(msgId)) {
        seenMessageIds.add(msgId);
        events.push({
          id: `${raw.uuid ?? randomUUID()}-usage`,
          sessionId,
          projectPath,
          sourceFile: filePath,
          lineNumber,
          timestamp,
          kind: "assistant_usage",
          role: "assistant",
          model,
          rawSizeBytes: serializeSize(msg.usage),
          estimatedTokens: 0,
          usage,
          metadata: {},
        });
      }

      // Emit tool_use events
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (typeof block !== "object" || block === null) continue;
          const b = block as Record<string, unknown>;
          if (b["type"] !== "tool_use") continue;

          const tu = b as unknown as RawToolUse;
          toolCallMap.set(tu.id, { name: tu.name, input: tu.input });

          const inputStr = tu.input != null ? JSON.stringify(tu.input) : "";
          events.push({
            id: raw.uuid ?? randomUUID(),
            sessionId,
            projectPath,
            sourceFile: filePath,
            lineNumber,
            timestamp,
            kind: "tool_use",
            role: "assistant",
            model,
            toolName: tu.name,
            toolInput: tu.input,
            toolUseId: tu.id,
            rawSizeBytes: serializeSize(tu.input),
            estimatedTokens: estimator.estimate(inputStr),
            metadata: { filePath: extractFilePath(tu.input) },
          });
        }
      }
    } else if (eventType === "user" && raw.message) {
      const msg = raw.message;
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (typeof block !== "object" || block === null) continue;
          const b = block as Record<string, unknown>;
          if (b["type"] !== "tool_result") continue;

          const toolUseId = typeof b["tool_use_id"] === "string" ? b["tool_use_id"] : undefined;
          const toolCall = toolUseId ? toolCallMap.get(toolUseId) : undefined;

          // Prefer structured toolUseResult for Bash output size
          let text: string;
          if (raw.toolUseResult && toolCall?.name === "Bash") {
            const tr = raw.toolUseResult;
            text = (tr.stdout ?? "") + (tr.stderr ?? "");
          } else {
            text = extractText(b["content"]);
          }

          const rawBytes = Buffer.byteLength(text, "utf8");
          events.push({
            id: raw.uuid ?? randomUUID(),
            sessionId,
            projectPath,
            sourceFile: filePath,
            lineNumber,
            timestamp,
            kind: "tool_result",
            role: "user",
            toolName: toolCall?.name,
            toolInput: toolCall?.input,
            toolUseId,
            text: text.slice(0, 2000),
            rawSizeBytes: rawBytes,
            estimatedTokens: estimator.estimate(text),
            metadata: { isError: b["is_error"] === true },
          });
        }
      }
    }
  }

  return { events, parseErrors, totalLines };
}

