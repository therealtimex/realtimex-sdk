---
name: pp-realtimex
description: "Printing Press CLI for Realtimex. API endpoints that enable programmatic reading, writing, and updating of your RealtimeX instance."
author: "Phuong Nguyen"
license: "Apache-2.0"
argument-hint: "<command> [args] | install cli|mcp"
allowed-tools: "Read Bash"
metadata:
  openclaw:
    requires:
      bins:
        - realtimex-pp-cli
---

# Realtimex — Printing Press CLI

## Prerequisites: Install the CLI

This skill drives the `realtimex-pp-cli` binary. **You must verify the CLI is installed before invoking any command from this skill.** If it is missing, install it first:

1. Install via the Printing Press installer:
   ```bash
   npx -y @mvanhorn/printing-press-library install realtimex --cli-only
   ```
2. Verify: `realtimex-pp-cli --version`
3. Ensure `$GOPATH/bin` (or `$HOME/go/bin`) is on `$PATH`.

If the `npx` install fails before this CLI has a public-library category, install Node or use the category-specific Go fallback after publish.

If `--version` reports "command not found" after install, the install step did not put the binary on `$PATH`. Do not proceed with skill commands until verification succeeds.

API endpoints that enable programmatic reading, writing, and updating of your RealtimeX instance. UI supplied by Swagger.io.

## Command Reference

**workspace** — Manage workspace

- `realtimex-pp-cli workspace create` — Create a new workspace
- `realtimex-pp-cli workspace delete` — Deletes a workspace by its slug.
- `realtimex-pp-cli workspace get` — Get a workspace by its unique slug.

**workspaces** — Manage workspaces

- `realtimex-pp-cli workspaces` — List all current workspaces


### Finding the right command

When you know what you want to do but not which command does it, ask the CLI directly:

```bash
realtimex-pp-cli which "<capability in your own words>"
```

`which` resolves a natural-language capability query to the best matching command from this CLI's curated feature index. Exit code `0` means at least one match; exit code `2` means no confident match — fall back to `--help` or use a narrower query.

## Auth Setup
Run `realtimex-pp-cli auth setup` to print the URL and steps for getting a key (add `--launch` to open the URL). Then set:

```bash
export REALTIMEX_APP_ID_AUTH="<your-key>"
```

Or persist it in `~/.config/realtimex-developer-pp-cli/config.toml`.

Run `realtimex-pp-cli doctor` to verify setup.

## Agent Mode

Add `--agent` to any command. Expands to: `--json --compact --no-input --no-color --yes`.

- **Pipeable** — JSON on stdout, errors on stderr
- **Filterable** — `--select` keeps a subset of fields. Dotted paths descend into nested structures; arrays traverse element-wise. Critical for keeping context small on verbose APIs:

  ```bash
  realtimex-pp-cli workspace get mock-value --agent --select id,name,status
  ```
- **Previewable** — `--dry-run` shows the request without sending
- **Offline-friendly** — sync/search commands can use the local SQLite store when available
- **Non-interactive** — never prompts, every input is a flag
- **Explicit retries** — use `--idempotent` only when an already-existing create should count as success, and `--ignore-missing` only when a missing delete target should count as success

### Response envelope

Commands that read from the local store or the API wrap output in a provenance envelope:

```json
{
  "meta": {"source": "live" | "local", "synced_at": "...", "reason": "..."},
  "results": <data>
}
```

Parse `.results` for data and `.meta.source` to know whether it's live or local. A human-readable `N results (live)` summary is printed to stderr only when stdout is a terminal AND no machine-format flag (`--json`, `--csv`, `--compact`, `--quiet`, `--plain`, `--select`) is set — piped/agent consumers and explicit-format runs get pure JSON on stdout.

## Agent Feedback

When you (or the agent) notice something off about this CLI, record it:

```
realtimex-pp-cli feedback "the --since flag is inclusive but docs say exclusive"
realtimex-pp-cli feedback --stdin < notes.txt
realtimex-pp-cli feedback list --json --limit 10
```

Entries are stored locally at `~/.local/share/realtimex-pp-cli/feedback.jsonl`. They are never POSTed unless `REALTIMEX_FEEDBACK_ENDPOINT` is set AND either `--send` is passed or `REALTIMEX_FEEDBACK_AUTO_SEND=true`. Default behavior is local-only.

Write what *surprised* you, not a bug report. Short, specific, one line: that is the part that compounds.

## Output Delivery

Every command accepts `--deliver <sink>`. The output goes to the named sink in addition to (or instead of) stdout, so agents can route command results without hand-piping. Three sinks are supported:

| Sink | Effect |
|------|--------|
| `stdout` | Default; write to stdout only |
| `file:<path>` | Atomically write output to `<path>` (tmp + rename) |
| `webhook:<url>` | POST the output body to the URL (`application/json` or `application/x-ndjson` when `--compact`) |

Unknown schemes are refused with a structured error naming the supported set. Webhook failures return non-zero and log the URL + HTTP status on stderr.

## Named Profiles

A profile is a saved set of flag values, reused across invocations. Use it when a scheduled agent calls the same command every run with the same configuration - HeyGen's "Beacon" pattern.

```
realtimex-pp-cli profile save briefing --json
realtimex-pp-cli --profile briefing workspace get mock-value
realtimex-pp-cli profile list --json
realtimex-pp-cli profile show briefing
realtimex-pp-cli profile delete briefing --yes
```

Explicit flags always win over profile values; profile values win over defaults. `agent-context` lists all available profiles under `available_profiles` so introspecting agents discover them at runtime.

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 2 | Usage error (wrong arguments) |
| 3 | Resource not found |
| 4 | Authentication required |
| 5 | API error (upstream issue) |
| 7 | Rate limited (wait and retry) |
| 10 | Config error |

## Argument Parsing

Parse `$ARGUMENTS`:

1. **Empty, `help`, or `--help`** → show `realtimex-pp-cli --help` output
2. **Starts with `install`** → ends with `mcp` → MCP installation; otherwise → see Prerequisites above
3. **Anything else** → Direct Use (execute as CLI command with `--agent`)

## MCP Server Installation

Install the MCP binary from this CLI's published public-library entry or pre-built release, then register it:

```bash
claude mcp add realtimex-pp-mcp -- realtimex-pp-mcp
```

Verify: `claude mcp list`

## Direct Use

1. Check if installed: `which realtimex-pp-cli`
   If not found, offer to install (see Prerequisites at the top of this skill).
2. Match the user query to the best command from the Unique Capabilities and Command Reference above.
3. Execute with the `--agent` flag:
   ```bash
   realtimex-pp-cli <command> [subcommand] [args] --agent
   ```
4. If ambiguous, drill into subcommand help: `realtimex-pp-cli <command> --help`.
