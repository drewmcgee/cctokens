import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
    // better-sqlite3 native module conflicts when tests share a worker process
    pool: "forks",
    coverage: {
      provider: "v8",
      include: ["src/**"],
    },
  },
});
