import { defineConfig } from "tsup";
import { cpSync, mkdirSync } from "fs";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  shims: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
  onSuccess: async () => {
    mkdirSync("dist/rules/builtin", { recursive: true });
    cpSync("src/rules/builtin", "dist/rules/builtin", { recursive: true });
  },
});
