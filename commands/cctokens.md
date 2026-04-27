# cctokens

Run Claude Code token/context diagnostics for this project.

Use when:
- The session feels expensive or context is filling quickly.
- Claude is rereading files or dumping test logs.
- You want a concise explanation of token usage.

```bash
cctokens doctor --project .
```

Return a concise summary of the top findings and recommended workflow changes. Do not paste full JSON output or raw transcript content.
