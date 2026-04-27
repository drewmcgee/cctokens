import { describe, it, expect } from "vitest";
import { loadRules, validateRuleFile } from "../../src/rules/loader.js";
import { join } from "path";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";

describe("loadRules — built-ins", () => {
  it("loads all 10 built-in rules", () => {
    const rules = loadRules();
    expect(rules.size).toBe(10);
  });

  it("every built-in has id, title, message, recommendations", () => {
    const rules = loadRules();
    for (const [id, loaded] of rules) {
      expect(loaded.config.id).toBe(id);
      expect(loaded.config.title.length).toBeGreaterThan(0);
      expect(loaded.config.message.length).toBeGreaterThan(0);
      expect(loaded.config.recommendations.length).toBeGreaterThan(0);
      expect(loaded.source).toBe("builtin");
    }
  });
});

describe("loadRules — user project override", () => {
  it("project-local rule overrides built-in threshold by id", () => {
    const tmpDir = join(tmpdir(), `cctokens-test-${Date.now()}`);
    const rulesDir = join(tmpDir, ".cctokens", "rules");
    mkdirSync(rulesDir, { recursive: true });
    writeFileSync(
      join(rulesDir, "repeated_file_read.yaml"),
      `id: repeated_file_read\ntitle: Override Title\ndescription: override\ncategory: repeated_work\nseverity: critical\nconfidence: high\nmessage: overridden\nrecommendations:\n  - do better\nthresholds:\n  min_count: 2\n`
    );

    const rules = loadRules(tmpDir);
    const override = rules.get("repeated_file_read");
    expect(override?.config.severity).toBe("critical");
    expect(override?.config.thresholds?.["min_count"]).toBe(2);
    expect(override?.source).toBe("project-local");

    rmSync(tmpDir, { recursive: true });
  });
});

describe("loadRules — unknown fields in YAML do not crash", () => {
  it("parses YAML with extra fields gracefully (strips unknowns via zod)", () => {
    const tmpDir = join(tmpdir(), `cctokens-test-${Date.now()}`);
    const rulesDir = join(tmpDir, ".cctokens", "rules");
    mkdirSync(rulesDir, { recursive: true });
    writeFileSync(
      join(rulesDir, "test_rule.yaml"),
      `id: test_rule\ntitle: Test\ncategory: unknown\nseverity: info\nconfidence: low\nmessage: test\nrecommendations:\n  - fix\nunknown_future_field: some_value\n`
    );

    expect(() => loadRules(tmpDir)).not.toThrow();
    rmSync(tmpDir, { recursive: true });
  });
});

describe("validateRuleFile", () => {
  it("returns valid for a well-formed rule file", () => {
    const tmpFile = join(tmpdir(), `valid-rule-${Date.now()}.yaml`);
    writeFileSync(
      tmpFile,
      `id: my_rule\ntitle: My Rule\ncategory: unknown\nseverity: warning\nconfidence: medium\nmessage: "test"\nrecommendations:\n  - fix it\n`
    );
    const result = validateRuleFile(tmpFile);
    expect(result.valid).toBe(true);
    rmSync(tmpFile);
  });

  it("returns errors for an invalid rule file", () => {
    const tmpFile = join(tmpdir(), `invalid-rule-${Date.now()}.yaml`);
    writeFileSync(tmpFile, `id: 123\ntitle: bad\n`);
    const result = validateRuleFile(tmpFile);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
