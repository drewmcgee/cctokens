import { describe, it, expect, afterEach } from "vitest";
import { join } from "path";
import { tmpdir } from "os";
import { chmodSync, mkdirSync, rmSync, existsSync, mkdtempSync } from "fs";
import { SqliteStore, resolveCacheStore } from "../../src/store/sqliteStore.js";
import { resolveDefaultCachePath } from "../../src/config.js";
import type { ParseResult } from "../../src/model/events.js";

function tempDb(): string {
  return join(tmpdir(), `cctokens-test-${Date.now()}.sqlite`);
}

function fakeResult(eventCount = 2): ParseResult {
  return {
    events: Array.from({ length: eventCount }, (_, i) => ({
      id: `ev-${i}`,
      sessionId: "sess",
      sourceFile: "/file.jsonl",
      lineNumber: i + 1,
      kind: "assistant_usage" as const,
      rawSizeBytes: 100,
      estimatedTokens: 50,
      metadata: {},
    })),
    parseErrors: 0,
    totalLines: eventCount,
  };
}

describe("SqliteStore", () => {
  let store: SqliteStore;
  let dbPath: string;

  afterEach(() => {
    store?.close();
    if (existsSync(dbPath)) rmSync(dbPath);
    const walPath = dbPath + "-wal";
    const shmPath = dbPath + "-shm";
    if (existsSync(walPath)) rmSync(walPath);
    if (existsSync(shmPath)) rmSync(shmPath);
  });

  it("returns null for unknown file", () => {
    dbPath = tempDb();
    store = new SqliteStore(dbPath);
    expect(store.get("/unknown.jsonl", Date.now(), 1000)).toBeNull();
  });

  it("returns cached result for unchanged file", () => {
    dbPath = tempDb();
    store = new SqliteStore(dbPath);
    const result = fakeResult(3);
    store.set("/file.jsonl", 1000, 500, 500, 3, result);
    const cached = store.get("/file.jsonl", 1000, 500);
    expect(cached).not.toBeNull();
    expect(cached!.events.length).toBe(3);
  });

  it("returns null and deletes entry when file shrank", () => {
    dbPath = tempDb();
    store = new SqliteStore(dbPath);
    const result = fakeResult(3);
    store.set("/file.jsonl", 1000, 500, 500, 3, result);
    const cached = store.get("/file.jsonl", 1000, 200); // size decreased
    expect(cached).toBeNull();
    // Confirm entry was deleted
    expect(store.get("/file.jsonl", 1000, 200)).toBeNull();
  });

  it("returns cached events when file grew (for incremental parse)", () => {
    dbPath = tempDb();
    store = new SqliteStore(dbPath);
    const result = fakeResult(3);
    store.set("/file.jsonl", 1000, 500, 500, 3, result);
    const cached = store.get("/file.jsonl", 1000, 800); // file grew
    // Returns existing cached events so caller can append
    expect(cached).not.toBeNull();
    expect(cached!.events.length).toBe(3);
    expect(cached!.lastByteOffset).toBe(500);
  });

  it("detects grown file via isGrown", () => {
    dbPath = tempDb();
    store = new SqliteStore(dbPath);
    store.set("/file.jsonl", 1000, 500, 500, 3, fakeResult(3));
    expect(store.isGrown("/file.jsonl", 800)).toBe(true);
    expect(store.isGrown("/file.jsonl", 500)).toBe(false);
    expect(store.isGrown("/file.jsonl", 400)).toBe(false);
  });

  it("upserts on repeated set for same file", () => {
    dbPath = tempDb();
    store = new SqliteStore(dbPath);
    store.set("/file.jsonl", 1000, 500, 500, 3, fakeResult(3));
    store.set("/file.jsonl", 2000, 600, 600, 4, fakeResult(4));
    const cached = store.get("/file.jsonl", 2000, 600);
    expect(cached!.events.length).toBe(4);
    expect(cached!.totalLines).toBe(4);
  });

  it("disables cache when the preferred path is blocked", () => {
    const root = mkdtempSync(join(tmpdir(), "cctokens-cache-"));
    const blockedDir = join(root, "blocked");
    mkdirSync(blockedDir);
    chmodSync(blockedDir, 0o500);

    const preferredPath = join(blockedDir, "cctokens.sqlite");
    try {
      const resolved = resolveCacheStore(preferredPath);

      expect(resolved.mode).toBe("disabled");
      expect(resolved.store).toBeNull();
      expect(resolved.warning).toMatch(/not writable/i);
    } finally {
      chmodSync(blockedDir, 0o700);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses a platform-native default cache path", () => {
    const path = resolveDefaultCachePath();
    if (process.platform === "darwin") {
      expect(path).toContain("/Library/Caches/cctokens/");
    } else if (process.platform === "win32") {
      expect(path.toLowerCase()).toContain("cctokens");
    } else {
      expect(path).toContain(".cache");
    }
  });
});
