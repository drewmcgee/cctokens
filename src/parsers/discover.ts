import { statSync, existsSync, createReadStream } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import { createInterface } from "readline";
import fg from "fast-glob";

export interface DiscoveredFile {
  path: string;
  mtimeMs: number;
  sizeBytes: number;
  projectPath: string;
}

export interface DiscoverOptions {
  claudeProjectsDir?: string;
}

// Read the first N lines of a file to find the cwd field.
// Line-based so we don't truncate long lines (e.g. compact summaries injected by /compact).
async function cwdFromFile(filePath: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const MAX_LINES = 20;
    let lineCount = 0;
    let resolved = false;

    const rl = createInterface({
      input: createReadStream(filePath, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });

    const finish = (value: string | undefined) => {
      if (resolved) return;
      resolved = true;
      rl.close();
      resolve(value);
    };

    rl.on("line", (line) => {
      if (resolved) return;
      lineCount++;
      const trimmed = line.trim();
      if (trimmed) {
        try {
          const obj = JSON.parse(trimmed) as Record<string, unknown>;
          if (typeof obj["cwd"] === "string") {
            finish(obj["cwd"] as string);
            return;
          }
        } catch {
          // skip unparseable lines
        }
      }
      if (lineCount >= MAX_LINES) finish(undefined);
    });

    rl.on("close", () => finish(undefined));
    rl.on("error", () => finish(undefined));
  });
}

export async function discoverFiles(
  opts: DiscoverOptions = {}
): Promise<DiscoveredFile[]> {
  const projectsDir =
    opts.claudeProjectsDir ?? join(homedir(), ".claude", "projects");

  if (!existsSync(projectsDir)) return [];

  const paths = await fg("**/*.jsonl", {
    cwd: projectsDir,
    absolute: true,
    followSymbolicLinks: false,
  });

  const results: DiscoveredFile[] = [];
  for (const p of paths) {
    try {
      const st = statSync(p);
      const projectPath = (await cwdFromFile(p)) ?? "";
      results.push({
        path: p,
        mtimeMs: st.mtimeMs,
        sizeBytes: st.size,
        projectPath,
      });
    } catch {
      // file vanished between glob and stat
    }
  }

  return results.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export async function findLastFile(
  currentDir: string,
  opts: DiscoverOptions = {}
): Promise<DiscoveredFile> {
  const allFiles = await discoverFiles(opts);
  if (allFiles.length === 0) {
    throw new Error(
      "No Claude Code transcript files found under ~/.claude/projects"
    );
  }

  const resolvedCwd = resolve(currentDir);

  const projectFiles = allFiles.filter(
    (f) => f.projectPath && resolve(f.projectPath) === resolvedCwd
  );

  if (projectFiles.length === 0) {
    throw new Error(
      `No Claude Code transcripts found for project: ${resolvedCwd}\n` +
        `Run cctokens from inside a Claude Code project directory.`
    );
  }

  return projectFiles[0]!;
}

export async function findProjectFiles(
  projectDir: string,
  opts: DiscoverOptions = {}
): Promise<DiscoveredFile[]> {
  const allFiles = await discoverFiles(opts);
  const resolved = resolve(projectDir);
  const matching = allFiles.filter(
    (f) => f.projectPath && resolve(f.projectPath) === resolved
  );

  if (matching.length === 0) {
    throw new Error(
      `No Claude Code transcripts found for project: ${resolved}`
    );
  }

  return matching;
}

export function statFile(
  filePath: string
): { mtimeMs: number; sizeBytes: number } {
  const st = statSync(filePath);
  return { mtimeMs: st.mtimeMs, sizeBytes: st.size };
}
