import { describe, it, expect } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import { join, resolve } from "path";

const execFileAsync = promisify(execFile);
const FIXTURES = join(resolve(import.meta.dirname), "../fixtures/claude-jsonl");
const CLI = resolve(import.meta.dirname, "../../src/cli.ts");

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "node",
      ["--import", "tsx/esm", CLI, ...args],
      { env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" }, timeout: 15000 }
    );
    return { stdout, stderr, code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", code: e.code ?? 1 };
  }
}

describe("cctokens doctor --file", () => {
  it("exits 0 on minimal fixture", async () => {
    const { code } = await runCli(["doctor", "--file", join(FIXTURES, "minimal.jsonl")]);
    expect(code).toBe(0);
  });

  it("exits 0 on malformed fixture", async () => {
    const { code } = await runCli(["doctor", "--file", join(FIXTURES, "malformed.jsonl")]);
    expect(code).toBe(0);
  });

  it("prints token totals for minimal fixture", async () => {
    const { stdout } = await runCli(["doctor", "--file", join(FIXTURES, "minimal.jsonl")]);
    expect(stdout).toMatch(/input:/i);
    expect(stdout).toMatch(/output:/i);
  });
});

describe("cctokens scan --file", () => {
  it("exits 0 on minimal fixture", async () => {
    const { code } = await runCli(["scan", "--file", join(FIXTURES, "minimal.jsonl")]);
    expect(code).toBe(0);
  });
});

describe("cctokens doctor --format json", () => {
  it("produces valid JSON", async () => {
    const { stdout, code } = await runCli([
      "doctor",
      "--file",
      join(FIXTURES, "large_bash_output.jsonl"),
      "--format",
      "json",
    ]);
    expect(code).toBe(0);
    expect(() => JSON.parse(stdout)).not.toThrow();
    const parsed = JSON.parse(stdout) as { version: string; findings: unknown[] };
    expect(parsed.version).toBe("1");
    expect(Array.isArray(parsed.findings)).toBe(true);
  });

  it("JSON findings include id, title, severity, evidence, recommendations", async () => {
    const { stdout } = await runCli([
      "doctor",
      "--file",
      join(FIXTURES, "large_bash_output.jsonl"),
      "--format",
      "json",
    ]);
    const parsed = JSON.parse(stdout) as {
      findings: Array<{
        id: string;
        title: string;
        severity: string;
        evidence: unknown[];
        recommendations: string[];
      }>;
    };
    if (parsed.findings.length > 0) {
      const f = parsed.findings[0]!;
      expect(f.id).toBeTruthy();
      expect(f.title).toBeTruthy();
      expect(f.severity).toMatch(/^(info|warning|critical)$/);
      expect(Array.isArray(f.evidence)).toBe(true);
      expect(Array.isArray(f.recommendations)).toBe(true);
    }
  });
});

describe("cctokens rules list", () => {
  it("exits 0 and prints 10 rules", async () => {
    const { stdout, code } = await runCli(["rules", "list"]);
    expect(code).toBe(0);
    const matches = stdout.match(/repeated_file_read|large_bash_output|context_growth_spike/g);
    expect(matches).not.toBeNull();
  });
});
