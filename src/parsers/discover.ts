import { statSync, existsSync, openSync, readSync, closeSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
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

// Read the first N bytes of a file to scan for cwd without loading it entirely.
function cwdFromFile(filePath: string): string | undefined {
  try {
    const fd = openSync(filePath, "r");
    const buf = Buffer.alloc(16384); // 16 KB — enough to find cwd in any real transcript
    const bytesRead = readSync(fd, buf, 0, buf.length, 0);
    closeSync(fd);
    const text = buf.subarray(0, bytesRead).toString("utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed) as Record<string, unknown>;
        if (typeof obj["cwd"] === "string") return obj["cwd"];
      } catch {
        // skip unparseable lines
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
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
      const projectPath = cwdFromFile(p) ?? "";
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
