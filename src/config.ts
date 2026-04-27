import { homedir } from "os";
import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { parse as parseYaml } from "yaml";

export interface CctokensConfig {
  version: number;
  sources: {
    claudeProjectsDir: string;
  };
  cache: {
    path: string;
  };
  estimation: {
    strategy: "char_div_4";
  };
  report: {
    maxFindings: number;
    defaultFormat: "text" | "json" | "markdown";
  };
  thresholds: {
    largeBashOutputTokens: number;
    largeFileReadTokens: number;
    repeatedFileReadCount: number;
    contextGrowthSpikeTokens: number;
    longSessionTurns: number;
    longSessionInputTokens: number;
  };
  privacy: {
    includeRawSnippets: boolean;
  };
}

export function resolveDefaultCachePath(): string {
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Caches", "cctokens", "cctokens.sqlite");
  }

  if (process.platform === "win32") {
    const localAppData = process.env["LOCALAPPDATA"];
    if (localAppData) {
      return join(localAppData, "cctokens", "cctokens.sqlite");
    }
    return join(homedir(), "AppData", "Local", "cctokens", "cctokens.sqlite");
  }

  const xdgCacheHome = process.env["XDG_CACHE_HOME"];
  if (xdgCacheHome) {
    return join(xdgCacheHome, "cctokens", "cctokens.sqlite");
  }

  return join(homedir(), ".cache", "cctokens", "cctokens.sqlite");
}

export const defaultConfig: CctokensConfig = {
  version: 1,
  sources: {
    claudeProjectsDir: join(homedir(), ".claude", "projects"),
  },
  cache: {
    path: resolveDefaultCachePath(),
  },
  estimation: {
    strategy: "char_div_4",
  },
  report: {
    maxFindings: 10,
    defaultFormat: "text",
  },
  thresholds: {
    largeBashOutputTokens: 4000,
    largeFileReadTokens: 8000,
    repeatedFileReadCount: 5,
    contextGrowthSpikeTokens: 25000,
    longSessionTurns: 40,
    longSessionInputTokens: 100000,
  },
  privacy: {
    includeRawSnippets: false,
  },
};

function mergeDeep<T extends object>(base: T, override: Partial<T>): T {
  const result = { ...base };
  for (const key of Object.keys(override) as (keyof T)[]) {
    const ov = override[key];
    const bv = base[key];
    if (ov !== undefined && typeof ov === "object" && !Array.isArray(ov) && typeof bv === "object" && bv !== null) {
      result[key] = mergeDeep(bv as object, ov as object) as T[keyof T];
    } else if (ov !== undefined) {
      result[key] = ov as T[keyof T];
    }
  }
  return result;
}

function loadYamlConfig(path: string): Partial<CctokensConfig> {
  try {
    const raw = readFileSync(path, "utf8");
    return parseYaml(raw) as Partial<CctokensConfig>;
  } catch {
    return {};
  }
}

export function loadConfig(projectDir?: string): CctokensConfig {
  let cfg = { ...defaultConfig };

  const userConfigPath = join(homedir(), ".config", "cctokens", "config.yaml");
  if (existsSync(userConfigPath)) {
    cfg = mergeDeep(cfg, loadYamlConfig(userConfigPath));
  }

  if (projectDir) {
    const projectConfigPath = join(projectDir, ".cctokens", "config.yaml");
    if (existsSync(projectConfigPath)) {
      cfg = mergeDeep(cfg, loadYamlConfig(projectConfigPath));
    }
  }

  return cfg;
}
