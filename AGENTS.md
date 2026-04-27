# cctokens Agent Guide

## Purpose

`cctokens` is a lightweight Claude Code token and context-waste diagnostic tool. It scans local Claude Code JSONL transcripts, computes logged token totals, detects waste patterns, and prints actionable terminal reports.

The product wedge is diagnostic: explain what behavior wasted context and how to change it.

## Scope

Claude Code only.

Do not add Codex, Cursor, dashboards, cloud sync, or AI-generated reports unless explicitly requested.

## Architecture

Keep the pipeline linear and testable:

1. Discover -> find JSONL files under `~/.claude/projects/**/*.jsonl`
2. Parse -> defensive per-line JSONL to raw entries
3. Normalize -> raw entries to `NormalizedEvent[]`
4. Cache -> SQLite store keyed by path and file identity
5. Detect -> deterministic rule engine over `NormalizedEvent[]`
6. Report -> `text | json | markdown`

Keep parsing, storage, diagnostics, and reporting in separate modules. Do not let detector logic bleed into parser logic.

## Design

- TypeScript, strict mode, Node.js 18+
- ESM-first output via `tsup`, with CJS output for compatibility
- `commander` for CLI parsing
- `zod` for runtime validation boundaries
- `yaml` for config and rule loading
- `fast-glob` for file discovery
- `better-sqlite3` for synchronous cache access
- `picocolors` for terminal color
- `vitest` for tests

## Cache policy

- Default cache path must come from the platform-native user cache location, not a repo-local hardcoded path.
- If the configured cache path is not writable, continue without cache rather than failing the CLI.
- Keep cache behavior explicit and testable.

## Token language

- Use `logged tokens` for values sourced from Claude Code usage fields
- Use `estimated tokens` for heuristic component counts
- Use `residual / unknown` when attribution cannot be observed

Never present estimated per-tool values as exact counts. Label them clearly.

## Rule engine

- Built-in YAML rules live in `src/rules/builtin/`
- TypeScript provides the detector logic
- User-rule load order:
  1. `src/rules/builtin/*.yaml`
  2. `~/.config/cctokens/rules/*.yaml`
  3. `.cctokens/rules/*.yaml`

## Principles

- Deterministic
- Local-first
- Graceful degradation
- No exact claims on estimates
- Concise over complete
- Privacy-first
- Incremental on unchanged files

## Commands

```bash
npm test
npm run lint
npm run typecheck
npm run build
npm run dev
```

Before marking work complete, run:

```bash
npm run typecheck && npm test
```

## Git workflow

- Commit after every feature addition or refactor
- Use logical atomic commits
- Never commit with failing tests or type errors

## Testing

- Use real fixture files for parser tests
- Do not mock `better-sqlite3` in cache tests
- Keep JSON reporter output as a stable contract
- Smoke test `cctokens doctor --file test/fixtures/claude-jsonl/minimal.jsonl`
- Smoke test `cctokens scan --file test/fixtures/claude-jsonl/minimal.jsonl`

## Coding style

- Prefer small pure functions over classes where practical
- No global mutable state
- Use dependency injection for filesystem, store, and estimator when possible
- No comments unless the why is non-obvious
- No docstrings; rely on clear names and types

## Privacy

Treat transcript content as sensitive.

- Never send transcript content to an external API
- Never log full tool results by default
- Never include raw transcript excerpts unless short and directly necessary
- Default config should keep raw snippets disabled

## Performance

JSONL files can be large. Incremental parsing is required. Avoid rereading unchanged files. SQLite reads should dominate repeated scans.

## Output style

Reports must be concise and actionable.

## Extensibility

- Built-in rules: `src/rules/builtin/`
- Project-local rules: `.cctokens/rules/*.yaml`

