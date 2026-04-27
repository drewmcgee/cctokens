import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { parse as parseYaml } from "yaml";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { RuleSchema, type RuleConfig } from "./schema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// In dev __dirname = src/rules/  → builtin is ./builtin
// In built __dirname = dist/     → builtin is ./rules/builtin
function resolveBuiltinDir(): string {
  const candidate1 = join(__dirname, "builtin");
  const candidate2 = join(__dirname, "rules", "builtin");
  if (existsSync(candidate1)) return candidate1;
  if (existsSync(candidate2)) return candidate2;
  return candidate1;
}

export type RuleSource = "builtin" | "user-global" | "project-local";

export interface LoadedRule {
  config: RuleConfig;
  source: RuleSource;
  filePath: string;
}

function loadYamlRulesFromDir(
  dir: string,
  source: RuleSource
): LoadedRule[] {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  const loaded: LoadedRule[] = [];
  for (const file of files) {
    const filePath = join(dir, file);
    try {
      const raw = readFileSync(filePath, "utf8");
      const parsed = parseYaml(raw);
      const result = RuleSchema.safeParse(parsed);
      if (result.success) {
        loaded.push({ config: result.data, source, filePath });
      }
      // silently skip invalid YAML rules (don't crash)
    } catch {
      // silently skip unreadable files
    }
  }
  return loaded;
}

export function loadRules(projectDir?: string): Map<string, LoadedRule> {
  const builtinDir = resolveBuiltinDir();
  const userGlobalDir = join(homedir(), ".config", "cctokens", "rules");
  const projectLocalDir = projectDir ? join(projectDir, ".cctokens", "rules") : null;

  const ruleMap = new Map<string, LoadedRule>();

  // Load in priority order: builtin first, then user-global, then project-local (highest priority)
  const builtins = loadYamlRulesFromDir(builtinDir, "builtin");
  for (const r of builtins) ruleMap.set(r.config.id, r);

  const userGlobal = loadYamlRulesFromDir(userGlobalDir, "user-global");
  for (const r of userGlobal) ruleMap.set(r.config.id, r);

  if (projectLocalDir) {
    const projectLocal = loadYamlRulesFromDir(projectLocalDir, "project-local");
    for (const r of projectLocal) ruleMap.set(r.config.id, r);
  }

  return ruleMap;
}

export function listRules(projectDir?: string): LoadedRule[] {
  const map = loadRules(projectDir);
  return Array.from(map.values());
}

export function validateRuleFile(filePath: string): { valid: boolean; errors: string[] } {
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = parseYaml(raw);
    const result = RuleSchema.safeParse(parsed);
    if (result.success) return { valid: true, errors: [] };
    return {
      valid: false,
      errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  } catch (err) {
    return { valid: false, errors: [String(err)] };
  }
}
