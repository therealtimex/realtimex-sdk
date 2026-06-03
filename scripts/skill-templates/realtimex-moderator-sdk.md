---
name: realtimex-moderator-sdk
description: "Use the RealTimeX API through the generated CLI for workspace, thread, and chat operations."
argument-hint: "<command> [args] | install cli"
---

## Prerequisites: Install the CLI

This skill drives the `realtimex-pp-cli` binary. Verify the CLI is installed before invoking any command from this skill. If it is missing, install it first:

1. Install via npm:
   ```bash
   npm install -g @realtimex/pp-cli@${SDK_VERSION}
   ```
2. Verify: `realtimex-pp-cli --version`

If `--version` reports "command not found" after install, the npm global bin directory is not on `$PATH`. Do not proceed with skill commands until verification succeeds.

## Constraints

Use only the `realtimex-pp-cli` commands documented by this skill. Never call the RealTimeX API directly with `curl`, `fetch`, raw HTTP clients, or custom scripts.

If a requested task is impossible with the current CLI commands, do not work around it through direct API calls or undocumented behavior. Say the feature is not available and will be added soon.
