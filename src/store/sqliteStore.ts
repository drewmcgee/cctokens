import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import type { NormalizedEvent, ParseResult } from "../model/events.js";

interface CacheRow {
  source_file: string;
  mtime_ms: number;
  size_bytes: number;
  last_byte_offset: number;
  last_line_number: number;
  events_json: string;
  parse_errors: number;
  total_lines: number;
  created_at: number;
}

export interface CachedResult {
  events: NormalizedEvent[];
  parseErrors: number;
  totalLines: number;
  lastByteOffset: number;
  lastLineNumber: number;
}

export class SqliteStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS file_cache (
        source_file     TEXT    PRIMARY KEY,
        mtime_ms        REAL    NOT NULL,
        size_bytes      INTEGER NOT NULL,
        last_byte_offset INTEGER NOT NULL,
        last_line_number INTEGER NOT NULL,
        events_json     TEXT    NOT NULL,
        parse_errors    INTEGER NOT NULL DEFAULT 0,
        total_lines     INTEGER NOT NULL DEFAULT 0,
        created_at      INTEGER NOT NULL
      );
    `);
  }

  get(
    sourceFile: string,
    mtimeMs: number,
    sizeBytes: number
  ): CachedResult | null {
    const row = this.db
      .prepare<[string], CacheRow>(
        "SELECT * FROM file_cache WHERE source_file = ?"
      )
      .get(sourceFile);

    if (!row) return null;

    // File shrank or mtime mismatch → stale
    if (row.mtime_ms !== mtimeMs || sizeBytes < row.size_bytes) {
      this.db
        .prepare("DELETE FROM file_cache WHERE source_file = ?")
        .run(sourceFile);
      return null;
    }

    // File unchanged
    if (row.size_bytes === sizeBytes) {
      return {
        events: JSON.parse(row.events_json) as NormalizedEvent[],
        parseErrors: row.parse_errors,
        totalLines: row.total_lines,
        lastByteOffset: row.last_byte_offset,
        lastLineNumber: row.last_line_number,
      };
    }

    // File grew — return existing cached events so caller can append
    return {
      events: JSON.parse(row.events_json) as NormalizedEvent[],
      parseErrors: row.parse_errors,
      totalLines: row.total_lines,
      lastByteOffset: row.last_byte_offset,
      lastLineNumber: row.last_line_number,
    };
  }

  isGrown(sourceFile: string, sizeBytes: number): boolean {
    const row = this.db
      .prepare<[string], Pick<CacheRow, "size_bytes">>(
        "SELECT size_bytes FROM file_cache WHERE source_file = ?"
      )
      .get(sourceFile);
    return row !== undefined && sizeBytes > row.size_bytes;
  }

  set(
    sourceFile: string,
    mtimeMs: number,
    sizeBytes: number,
    lastByteOffset: number,
    lastLineNumber: number,
    result: ParseResult
  ): void {
    this.db
      .prepare(
        `INSERT INTO file_cache
           (source_file, mtime_ms, size_bytes, last_byte_offset, last_line_number,
            events_json, parse_errors, total_lines, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(source_file) DO UPDATE SET
           mtime_ms = excluded.mtime_ms,
           size_bytes = excluded.size_bytes,
           last_byte_offset = excluded.last_byte_offset,
           last_line_number = excluded.last_line_number,
           events_json = excluded.events_json,
           parse_errors = excluded.parse_errors,
           total_lines = excluded.total_lines,
           created_at = excluded.created_at`
      )
      .run(
        sourceFile,
        mtimeMs,
        sizeBytes,
        lastByteOffset,
        lastLineNumber,
        JSON.stringify(result.events),
        result.parseErrors,
        result.totalLines,
        Date.now()
      );
  }

  clear(sourceFile?: string): void {
    if (sourceFile) {
      this.db
        .prepare("DELETE FROM file_cache WHERE source_file = ?")
        .run(sourceFile);
    } else {
      this.db.prepare("DELETE FROM file_cache").run();
    }
  }

  close(): void {
    this.db.close();
  }
}

export function openStore(dbPath: string): SqliteStore {
  return new SqliteStore(dbPath);
}
