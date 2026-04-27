---
name: cctokens project state
description: Architecture and implementation state of the cctokens MVP
type: project
---

cctokens MVP is fully implemented and all 41 tests pass.

**Why:** User requested a production-grade Claude Code context-waste diagnostics CLI.

**How to apply:** When continuing this project, the full pipeline is implemented and working.

Key decisions:
- better-sqlite3 v12.9.0 required (v9 does not build on Node 23)
- vitest must use pool:"forks" due to better-sqlite3 native module conflicts
- JSONL format: assistant events contain usage at event.message.usage; tool_use blocks in event.message.content; tool_result blocks are in user events with toolUseResult at top level
- Plugin files at .claude-plugin/plugin.json + commands/ agents/ hooks/ at repo root
- Real transcript samples in test/fixtures/claude-jsonl/real-samples/ (excluded from git by .gitignore)
