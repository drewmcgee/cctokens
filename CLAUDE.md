# cctokens Development Guide

## Project purpose

`cctokens` is a lightweight Claude Code token and context-waste diagnostic tool. It scans local Claude Code JSONL transcripts, computes logged token totals, detects waste patterns, and prints actionable terminal reports.

The product wedge is diagnostic: explain **what behavior wasted context** and how to change it.

## MVP scope

Claude Code only.

Do not add Codex, Cursor, dashboards, cloud sync, or AI-generated reports unless explicitly requested.

---

## Architecture

Linear pipeline — each stage is independently testable:

```
1. Discover   →  find JSONL files under ~/.claude/projects/**/*.jsonl
2. Parse      →  defensive per-line JSONL → raw entries
3. Normalize  →  raw entries → NormalizedEvent[]
4. Cache      →  SQLite store keyed by (path, mtime, size, offset, line)
5. Detect     →  deterministic rule engine over NormalizedEvent[]
6. Report     →  text | json | markdown renderer
```

**Keep parsing, storage, diagnostics, and reporting in separate modules.** Never let detector logic bleed into parser logic.

---

## Design decisions

### Language & runtime
- TypeScript, strict mode, targeting Node.js 18+
- ESM-first output via `tsup`; also emits CJS for broad compatibility
- Bin entry resolves to `./dist/cli.js`

### Key dependencies

| Purpose | Library | Reason |
|---------|---------|--------|
| CLI parsing | `commander` | Mature, well-typed, widely used |
| Schema validation | `zod` | Runtime safety at all external-data boundaries |
| YAML loading | `yaml` | Standard; handles YAML 1.2 |
| File discovery | `fast-glob` | High-performance glob on large trees |
| SQLite cache | `better-sqlite3` | Synchronous API fits CLI; no async overhead |
| Terminal color | `picocolors` | Lightweight, zero dependencies |
| Build | `tsup` | Zero-config ESM+CJS bundler |
| Dev runner | `tsx` | Zero-config TypeScript execution |
| Test | `vitest` | Fast, ESM-native, watch mode |
| Linter | `eslint` + `@typescript-eslint` | Standard TS linting |

### "Last session" resolution
`--last` selects the JSONL file with the most recent **mtime** across all files under `~/.claude/projects/**/*.jsonl`.
If invoked from inside a Claude project directory (cwd matches a known project path), prefer the most recent file for that project.

### Token language
Always use precise language to avoid misleading users:
- **"logged tokens"** — values sourced directly from Claude Code `usage` fields (authoritative)
- **"estimated tokens"** — component-level counts computed via the char÷4 heuristic
- **"residual / unknown"** — when attribution cannot be observed

Never present estimated per-tool values as exact counts. Label them "~N tokens (est.)".

### Token estimation
Default strategy: `CharDivFourEstimator` — `ceil(charCount / 4)`.

The estimator interface is pluggable:
```typescript
interface TokenEstimator {
  estimate(text: string): number;
}
```

Only `CharDivFourEstimator` is implemented in the MVP.

### SQLite cache
- Location: `~/.cache/cctokens/cctokens.sqlite`
- Cache key: `(source_file, mtime, size_bytes, last_byte_offset, last_line_number)`
- If file unchanged → use cached normalized events and aggregates
- If file **grew** → parse only appended bytes (seek to `last_byte_offset`)
- If file **shrank** or mtime inconsistent → full rescan

### Rule engine
Built-in YAML rules live in `src/rules/builtin/`. Each rule `id` maps to a TypeScript detector class. YAML provides thresholds, severity, messages, and recommendations. TypeScript provides detection logic.

User-rule load order (later entries override earlier by `id`):
1. `src/rules/builtin/*.yaml`
2. `~/.config/cctokens/rules/*.yaml`
3. `.cctokens/rules/*.yaml` (project-local, highest priority)

Message templates use `{{variable}}` syntax — e.g. `{{file}}`, `{{count}}`, `{{basename}}`.

### Finding sort order
```
severity (critical → warning → info)
  → estimatedTokens (desc)
    → confidence (high → medium → low)
```

---

## Design principles

- **Deterministic** — same input always produces same output; no AI-generated text in reports
- **Local-first** — zero network calls, zero telemetry
- **Graceful degradation** — malformed JSONL lines are counted and skipped, never throw
- **No exact claims on estimates** — always qualify estimated values
- **Concise over complete** — reports answer one question: "why did this session waste context?"
- **Privacy-first** — never include raw transcript content in reports by default
- **Incremental** — never reparse unchanged files

---

## Commands

```bash
npm test           # run unit + integration tests
npm run lint       # eslint check
npm run typecheck  # tsc --noEmit
npm run build      # tsup production build
npm run dev        # tsx src/cli.ts (dev runner)
```

**Before marking any task complete, always run:**
```bash
npm run typecheck && npm test
```

## Git workflow

Commit after every feature addition or refactor. Use logical atomic commits — one concern per commit.

Suggested commit sequence for new work:
1. Core model / type changes
2. Parser / discovery changes
3. Detector or rule changes
4. Reporter / CLI changes
5. Tests and fixtures

Always run `npm run typecheck && npm test` before committing. Never commit with failing tests or type errors.

---

## Testing strategy

### Fixture files
All fixtures live in `test/fixtures/claude-jsonl/`. One file per scenario — synthetic, minimal, deterministic:

| Fixture | Purpose |
|---------|---------|
| `large_bash_output.jsonl` | Single Bash result >4k estimated tokens |
| `repeated_file_read.jsonl` | Same file Read 6+ times |
| `full_test_suite.jsonl` | `pytest` called 4+ times with large output |
| `broad_glob.jsonl` | Grep/Glob over `.` or `**` |
| `context_growth.jsonl` | `input_tokens` grows >25k between turns |
| `malformed.jsonl` | Mix of valid and malformed JSON lines |
| `no_usage.jsonl` | Valid structure, `usage` fields absent |
| `minimal.jsonl` | Single clean turn, usage present, no waste |
| `multi_detector.jsonl` | Multiple waste patterns in one session |

### Unit tests — what to cover
- Parser: malformed lines skipped, count incremented
- Parser: missing `usage` fields → `usage: undefined` not crash
- Parser: duplicate `id` events handled
- Each detector: fires on matching fixture, silent on non-matching
- Rule loader: YAML threshold overrides take effect
- Rule loader: unknown fields in YAML do not crash
- Text reporter: output matches snapshot (plain text, no ANSI in snapshot)
- JSON reporter: output is valid JSON with stable schema
- Cache: unchanged file returns cached events without re-reading
- Cache: grown file only parses appended bytes

### Integration / smoke tests
- `cctokens doctor --file test/fixtures/claude-jsonl/minimal.jsonl` exits 0
- `cctokens scan --file test/fixtures/claude-jsonl/minimal.jsonl` exits 0
- JSON output from `--format json` parses without error

### Do-nots for testing
- Do **not** snapshot ANSI terminal output (fragile across environments)
- Do **test** JSON reporter output as a stable contract
- Do **not** mock the filesystem for parser tests; use real fixture files
- Do **not** mock `better-sqlite3` in cache tests; use an in-memory or temp-path database

---

## Coding style

- TypeScript `strict: true` throughout
- Prefer small pure functions over classes where practical
- No global mutable state
- Dependency injection for filesystem, store, and estimator (enables testing without mocking globals)
- No comments unless the **why** is non-obvious (hidden constraint, workaround, subtle invariant)
- No docstrings; rely on well-named identifiers and types

---

## Privacy

This tool reads local Claude Code transcripts. Treat all transcript content as sensitive.

- Never send transcript content to any external API
- Never log full tool results by default
- Never include raw transcript excerpts in reports unless short and directly necessary
- Default config: `privacy.include_raw_snippets: false`

---

## Performance

JSONL files can be large (hundreds of MB for long sessions).

Incremental parse is **required** — key by: `(file path, mtime, size_bytes, byte_offset, line_number)`.

Avoid reading unchanged files. On the hot path (repeated `doctor --last`), the SQLite read should dominate, not file I/O.

---

## Output style

Reports must be **concise and actionable**.

**Good:**
> `src/planner.ts` was read 11 times without changing. Estimated payload: ~36k tokens.
> Fix: create `.claude/notes/planner.md` or ask Claude not to reread unless changed.

**Bad:**
> Token usage appears suboptimal due to repeated context utilization patterns.

---

## Extensibility

Built-in rules: `src/rules/builtin/`

User rules:
- `.cctokens/rules/*.yaml` — project-local overrides
- `~/.config/cctokens/rules/*.yaml` — user-global overrides

The `cctokens rules list` command shows all loaded rules with source.
The `cctokens rules validate` command checks user YAML files against the schema.

---

## Do not build in this MVP

- Web UI or dashboard
- Cloud service or sync
- Billing-grade exact token attribution
- Full tokenizer integration (tiktoken, etc.)
- Codex / Cursor / other provider support
- AI-generated report text
- MCP server
- Automatic mutation of user's `CLAUDE.md`
