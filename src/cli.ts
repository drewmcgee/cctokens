import { Command, Option } from "commander";
import { resolve, join } from "path";
import { statSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";

import { loadConfig } from "./config.js";
import { parseJsonlFile } from "./parsers/claudeCodeJsonl.js";
import { discoverFiles, findLastFile, findProjectFiles, statFile } from "./parsers/discover.js";
import { loadRules, listRules, validateRuleFile } from "./rules/loader.js";
import { resolveCacheStore, type SqliteStore } from "./store/sqliteStore.js";
import { runDetectors } from "./diagnostics/engine.js";
import { createDefaultDetectors } from "./diagnostics/detectors/index.js";
import { renderTextReport, renderUsageTable, type ScanSummary } from "./report/textReporter.js";
import { renderJsonReport } from "./report/jsonReporter.js";
import { renderMarkdownReport } from "./report/markdownReporter.js";
import { buildContextBreakdown, renderContextBreakdown } from "./report/contextBreakdown.js";
import type { ParseResult } from "./model/events.js";

const program = new Command();

program
  .name("cctokens")
  .description("Claude Code context-waste diagnostics")
  .version("0.1.0");

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

type OutputFormat = "text" | "json" | "markdown";

function pickFormat(opt: string | undefined, defaultFmt: OutputFormat): OutputFormat {
  if (opt === "json" || opt === "markdown" || opt === "text") return opt;
  return defaultFmt;
}

async function loadEventsFromFile(
  filePath: string,
  cacheStore: SqliteStore | null
): Promise<{ parseResult: ParseResult; fromCache: boolean }> {
  if (!cacheStore) {
    const parseResult = await parseJsonlFile(filePath, { startOffset: 0, startLine: 0 });
    return { parseResult, fromCache: false };
  }

  try {
    const { mtimeMs, sizeBytes } = statFile(filePath);
    const cached = cacheStore.get(filePath, mtimeMs, sizeBytes);

    if (cached && cached.lastByteOffset === sizeBytes) {
      // Fully cached and unchanged
      return {
        parseResult: {
          events: cached.events,
          parseErrors: cached.parseErrors,
          totalLines: cached.totalLines,
        },
        fromCache: true,
      };
    }

    // Parse (incremental if file grew, full otherwise)
    const startOffset = cached && cacheStore.isGrown(filePath, sizeBytes) ? cached.lastByteOffset : 0;
    const startLine = cached && startOffset > 0 ? cached.totalLines : 0;

    const fresh = await parseJsonlFile(filePath, { startOffset, startLine });

    const events = startOffset > 0 && cached ? [...cached.events, ...fresh.events] : fresh.events;
    const parseErrors = (cached?.parseErrors ?? 0) + (startOffset > 0 ? fresh.parseErrors : fresh.parseErrors);
    const totalLines = (startOffset > 0 && cached ? cached.totalLines : 0) + fresh.totalLines;

    const result: ParseResult = { events, parseErrors, totalLines };

    cacheStore.set(filePath, mtimeMs, sizeBytes, sizeBytes, totalLines, result);
    return { parseResult: result, fromCache: false };
  } catch (err) {
    throw err;
  }
}

function buildSummary(filePath: string, result: ParseResult, projectPath?: string): ScanSummary {
  const sessionId = result.events[0]?.sessionId;

  let totalInput = 0, totalOutput = 0, totalCR = 0, totalCW = 0;
  const seenUsageIds = new Set<string>();

  for (const ev of result.events) {
    if (ev.kind !== "assistant_usage" || !ev.usage) continue;
    const dedupeKey = ev.id;
    if (seenUsageIds.has(dedupeKey)) continue;
    seenUsageIds.add(dedupeKey);
    totalInput += ev.usage.inputTokens ?? 0;
    totalOutput += ev.usage.outputTokens ?? 0;
    totalCR += ev.usage.cacheReadInputTokens ?? 0;
    totalCW += ev.usage.cacheCreationInputTokens ?? 0;
  }

  return {
    sourceFile: filePath,
    sessionId,
    projectPath,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    totalCacheReadTokens: totalCR,
    totalCacheWriteTokens: totalCW,
    parseErrors: result.parseErrors,
    totalLines: result.totalLines,
  };
}

function formatOutput(
  format: OutputFormat,
  summary: ScanSummary,
  findings: ReturnType<typeof runDetectors>,
  maxFindings: number,
  noColor: boolean
): string {
  if (format === "json") return renderJsonReport(summary, findings, maxFindings);
  if (format === "markdown") return renderMarkdownReport(summary, findings, maxFindings);
  return renderTextReport(summary, findings, { maxFindings, noColor });
}

// ---------------------------------------------------------------------------
// scan
// ---------------------------------------------------------------------------

const scan = new Command("scan")
  .description("Show logged token totals for one or more sessions")
  .option("--last", "scan the most recent session in the current project")
  .option("--file <path>", "scan a specific JSONL file")
  .option("--project <dir>", "scan all sessions for a project directory")
  .addOption(new Option("--format <fmt>", "output format").choices(["text", "json", "markdown"]).default("text"))
  .option("--context-breakdown", "show context composition at peak turn, grouped by tool")
  .option("--no-color", "disable color output")
  .action(async (opts) => {
    const cfg = loadConfig(opts.project);
    const cwd = process.cwd();
    const cache = resolveCacheStore(cfg.cache.path);
    const cacheStore = cache.store;

    try {
      if (cache.warning) console.error(cache.warning);

      const files: Array<{ path: string; projectPath?: string }> = [];

      if (opts.file) {
        files.push({ path: resolve(opts.file) });
      } else if (opts.last) {
        const f = await findLastFile(cwd, { claudeProjectsDir: cfg.sources.claudeProjectsDir });
        files.push({ path: f.path, projectPath: f.projectPath });
      } else if (opts.project) {
        const found = await findProjectFiles(resolve(opts.project), { claudeProjectsDir: cfg.sources.claudeProjectsDir });
        for (const f of found) files.push({ path: f.path, projectPath: f.projectPath });
      } else {
        const found = await findLastFile(cwd, { claudeProjectsDir: cfg.sources.claudeProjectsDir });
        files.push({ path: found.path, projectPath: found.projectPath });
      }

      const fmt = pickFormat(opts.format, cfg.report.defaultFormat);
      const noColor = opts.color === false;

      const summaries: ScanSummary[] = [];
      const allParseResults: Array<{ path: string; parseResult: ParseResult }> = [];

      for (const f of files) {
        const { parseResult } = await loadEventsFromFile(f.path, cacheStore);
        summaries.push(buildSummary(f.path, parseResult, f.projectPath));
        allParseResults.push({ path: f.path, parseResult });
      }

      if (fmt === "json") {
        console.log(JSON.stringify(summaries, null, 2));
      } else {
        console.log(renderUsageTable(summaries, noColor));

        if (opts.contextBreakdown) {
          for (const { parseResult } of allParseResults) {
            const bd = buildContextBreakdown(parseResult.events);
            console.log("");
            console.log(renderContextBreakdown(bd, noColor));
          }
        }
      }
    } catch (err) {
      console.error(`Error: ${String(err instanceof Error ? err.message : err)}`);
      process.exit(1);
    } finally {
      cacheStore?.close();
    }
  });

// ---------------------------------------------------------------------------
// doctor
// ---------------------------------------------------------------------------

const doctor = new Command("doctor")
  .description("Show ranked context-waste findings for a session")
  .option("--last", "analyse the most recent session in the current project")
  .option("--file <path>", "analyse a specific JSONL file")
  .option("--project <dir>", "analyse the most recent session for a project directory")
  .addOption(new Option("--format <fmt>", "output format").choices(["text", "json", "markdown"]).default("text"))
  .option("--max-findings <n>", "maximum number of findings to show", "10")
  .option("--no-color", "disable color output")
  .action(async (opts) => {
    const cfg = loadConfig(opts.project);
    const cwd = process.cwd();
    const maxFindings = Math.max(1, parseInt(opts.maxFindings, 10) || 10);
    const fmt = pickFormat(opts.format, cfg.report.defaultFormat);
    const noColor = opts.color === false;
    const cache = resolveCacheStore(cfg.cache.path);
    const cacheStore = cache.store;

    try {
      if (cache.warning) console.error(cache.warning);

      let filePath: string;
      let projectPath: string | undefined;

      if (opts.file) {
        filePath = resolve(opts.file);
      } else if (opts.last) {
        const f = await findLastFile(cwd, { claudeProjectsDir: cfg.sources.claudeProjectsDir });
        filePath = f.path;
        projectPath = f.projectPath;
      } else if (opts.project) {
        const found = await findProjectFiles(resolve(opts.project), { claudeProjectsDir: cfg.sources.claudeProjectsDir });
        filePath = found[0]!.path;
        projectPath = found[0]!.projectPath;
      } else {
        const f = await findLastFile(cwd, { claudeProjectsDir: cfg.sources.claudeProjectsDir });
        filePath = f.path;
        projectPath = f.projectPath;
      }

      const { parseResult } = await loadEventsFromFile(filePath, cacheStore);
      const summary = buildSummary(filePath, parseResult, projectPath);

      const rules = loadRules(opts.project);
      const detectors = createDefaultDetectors();
      const findings = runDetectors(parseResult.events, rules, detectors);

      console.log(formatOutput(fmt, summary, findings, maxFindings, noColor));
    } catch (err) {
      console.error(`Error: ${String(err instanceof Error ? err.message : err)}`);
      process.exit(1);
    } finally {
      cacheStore?.close();
    }
  });

// ---------------------------------------------------------------------------
// watch
// ---------------------------------------------------------------------------

const watch = new Command("watch")
  .description("Tail the active Claude Code session and update diagnostics incrementally")
  .option("--project <dir>", "project directory to watch")
  .option("--interval <ms>", "polling interval in milliseconds", "2000")
  .addOption(new Option("--format <fmt>", "output format").choices(["text", "json", "markdown"]).default("text"))
  .option("--no-color", "disable color output")
  .action(async (opts) => {
    const cfg = loadConfig(opts.project);
    const cwd = process.cwd();
    const interval = Math.max(500, parseInt(opts.interval, 10) || 2000);
    const fmt = pickFormat(opts.format, cfg.report.defaultFormat);
    const noColor = opts.color === false;
    const cache = resolveCacheStore(cfg.cache.path);
    const cacheStore = cache.store;

    console.log(`Watching for changes (polling every ${interval}ms)… Ctrl+C to stop.\n`);
    if (cache.warning) console.error(cache.warning);

    let lastSizeBytes = 0;
    let targetFile: string | undefined;
    let targetProject: string | undefined;

    const tick = async () => {
      try {
        const discovered = opts.project
          ? await findProjectFiles(resolve(opts.project), { claudeProjectsDir: cfg.sources.claudeProjectsDir })
          : await findProjectFiles(cwd, { claudeProjectsDir: cfg.sources.claudeProjectsDir });

        const latest = discovered[0];
        if (!latest) return;

        if (latest.path !== targetFile) {
          targetFile = latest.path;
          targetProject = latest.projectPath;
          lastSizeBytes = 0;
          console.clear();
          console.log(`Watching: ${targetFile}\n`);
        }

        const { sizeBytes } = statFile(targetFile);
        if (sizeBytes === lastSizeBytes) return;
        lastSizeBytes = sizeBytes;

        const { parseResult } = await loadEventsFromFile(targetFile, cacheStore);
        const summary = buildSummary(targetFile, parseResult, targetProject);
        const rules = loadRules(opts.project);
        const detectors = createDefaultDetectors();
        const findings = runDetectors(parseResult.events, rules, detectors);

        console.clear();
        console.log(formatOutput(fmt, summary, findings, 5, noColor));
      } catch {
        // silently retry on transient errors
      }
    };

    await tick();
    const handle = setInterval(() => { void tick(); }, interval);

    process.on("SIGINT", () => {
      clearInterval(handle);
      cacheStore?.close();
      process.exit(0);
    });
  });

// ---------------------------------------------------------------------------
// rules
// ---------------------------------------------------------------------------

const rulesCmd = new Command("rules").description("Manage diagnostic rules");

rulesCmd
  .command("list")
  .description("List all loaded rules")
  .option("--project <dir>", "project directory for project-local rules")
  .action((opts) => {
    const rules = listRules(opts.project);
    console.log(`\nLoaded rules (${rules.length}):\n`);
    for (const r of rules) {
      console.log(`  ${r.config.id.padEnd(28)} [${r.config.severity}] ${r.config.title}  (${r.source})`);
    }
    console.log("");
  });

rulesCmd
  .command("validate <file>")
  .description("Validate a user YAML rule file")
  .action((filePath: string) => {
    const result = validateRuleFile(resolve(filePath));
    if (result.valid) {
      console.log(`✓ ${filePath} is valid.`);
    } else {
      console.error(`✗ ${filePath} is invalid:`);
      for (const e of result.errors) {
        console.error(`  - ${e}`);
      }
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

const initCmd = new Command("init")
  .description("Initialise cctokens config and plugin files in the current project")
  .option("--force", "overwrite existing config files")
  .action((opts) => {
    const cwd = process.cwd();

    const configDir = join(cwd, ".cctokens");
    const rulesDir = join(configDir, "rules");
    const commandsDir = join(cwd, ".claude", "commands");
    const configFile = join(configDir, "config.yaml");

    mkdirSync(rulesDir, { recursive: true });
    mkdirSync(commandsDir, { recursive: true });

    if (!existsSync(configFile) || opts.force) {
      writeFileSync(
        configFile,
        `version: 1\n\n# Override thresholds here. See cctokens docs for full schema.\n# thresholds:\n#   large_bash_output_tokens: 4000\n#   repeated_file_read_count: 5\n`
      );
      console.log(`Created ${configFile}`);
    } else {
      console.log(`Skipped ${configFile} (already exists; use --force to overwrite)`);
    }

    const commandFile = join(commandsDir, "cctokens.md");
    if (!existsSync(commandFile) || opts.force) {
      writeFileSync(
        commandFile,
        `# cctokens\n\nRun Claude Code token/context diagnostics for this project.\n\n\`\`\`bash\ncctokens doctor --project .\n\`\`\`\n\nReturn a concise summary of the top findings and recommended changes.\n`
      );
      console.log(`Created ${commandFile}`);
    } else {
      console.log(`Skipped ${commandFile} (already exists)`);
    }

    console.log(`\ncctokens initialised in ${cwd}`);
    console.log(`Add rules to ${rulesDir} to override built-in thresholds.`);
  });

// ---------------------------------------------------------------------------
// Assemble
// ---------------------------------------------------------------------------

program.addCommand(scan);
program.addCommand(doctor);
program.addCommand(watch);
program.addCommand(rulesCmd);
program.addCommand(initCmd);

program.parse(process.argv);
