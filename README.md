# cctokens

You ran a Claude Code session. It used 160,000 tokens. Where did they go?

```
$ cctokens scan --context-breakdown

Context composition at peak (~160,456 tokens logged):

  Assistant history          ████████████████░░░░  82%  ~132,367 tokens logged  (173 turns, 162 tool calls)
  Tool results               ██░░░░░░░░░░░░░░░░░░  12%  ~18,913 tokens est.  (146 calls)
      Bash                   █░░░░░░░░░░░░░░░░░░░   7%  ~11,348 est. (53 calls)
      WebFetch               ░░░░░░░░░░░░░░░░░░░░   2%  ~2,453 est.  (2 calls)
  Human turns                █░░░░░░░░░░░░░░░░░░░   3%  ~5,558 tokens est.
  Unattributed residual      ░░░░░░░░░░░░░░░░░░░░   2%  ~3,618 tokens  (system prompt + est. error)

  156,838 / 160,456 tokens attributed (98%)
```

82% is conversation history — every response accumulates and gets re-sent on the next turn. By turn 173 you're carrying 130K tokens of "everything Claude said so far" with every request. `cctokens` makes this visible so you know when to `/compact`, what to stop doing, and what's actually burning your budget.

---

## Install

```bash
npm install -g cctokens
```

Run from inside any Claude Code project directory.

---

## Commands

**`cctokens scan`** — token totals for the current session

```bash
cctokens scan
cctokens scan --context-breakdown   # full context attribution
cctokens scan --last                # most recent session
cctokens scan --project .           # all sessions in this project
```

**`cctokens doctor`** — ranked waste findings with fixes

```bash
cctokens doctor
cctokens doctor --format json
cctokens doctor --format markdown
```

Example output:

```
[critical] Large Bash Output
  src/app/main.py was read 11 times without changing. ~36k tokens wasted.
  Fix: cache the result or ask Claude not to reread unless the file changes.

[warning] Context Growth Spike
  Context jumped +42,000 tokens in one turn.
  Contributors: npm test output (~18k est.), WebFetch result (~8k est.)
```

**`cctokens watch`** — live tail of the active session, updates as Claude works

```bash
cctokens watch
```

---

## What it detects

| Rule | What triggers it |
|------|-----------------|
| `large_bash_output` | Single Bash result over 4k tokens |
| `repeated_file_read` | Same file read 5+ times without a write in between |
| `full_test_suite_run` | Test runner called 4+ times with large output |
| `broad_glob` | Grep or glob over `.` or `**` |
| `context_growth_spike` | Context grows >25k tokens in a single turn |
| `cache_write_spike` | Cache write over 20k tokens in a single turn |
| `long_session_drag` | 40+ turns with >100k token context |

Thresholds are configurable. Drop a YAML file in `.cctokens/rules/` to override any rule for a project, or `~/.config/cctokens/rules/` for global defaults.

---

## How it works

Claude Code writes every conversation turn to a JSONL file under `~/.claude/projects/`. `cctokens` reads those files directly — no network calls, no API keys, no telemetry.

The context attribution uses the logged `output_tokens` field from each turn rather than estimating: each turn's output becomes the next turn's input, so summing prior output tokens gives the exact assistant history size. Tool result sizes are estimated via `ceil(chars / 4)`.

Results are cached in SQLite under the platform's standard user cache directory, keyed on file path and mtime, so repeated scans on unchanged sessions are instant.
If that directory is not writable, `cctokens` keeps working without cache.

---

## Configuration

```bash
cctokens init   # creates .cctokens/config.yaml in the current project
```

```yaml
# .cctokens/config.yaml
version: 1
thresholds:
  large_bash_output_tokens: 4000
  repeated_file_read_count: 5
```

```bash
cctokens rules list      # show all loaded rules and their source
cctokens rules validate  # check a user YAML file
```

---

## Token language

Numbers in this tool mean different things depending on their source:

- **logged** — taken directly from `usage` fields in the JSONL. Exact.
- **est.** — estimated via `ceil(chars / 4)`. Accurate to within ~1.5–2× on code-heavy sessions. Always labeled.

The context breakdown header always shows the logged peak. Per-component estimates are marked `est.` in the output.
