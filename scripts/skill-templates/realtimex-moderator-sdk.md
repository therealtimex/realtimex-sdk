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

If the task requires any CLI argument, identifier, selection, target, content, or option and the user has not provided enough context to identify it unambiguously, ask a concise clarification question before running commands. Do not guess required values from unrelated prior context. Examples: if the user says "send a message with model gpt-4.1-nano" but does not name the workspace and thread, ask which workspace and thread to use; if the user says "delete it" but the target is unclear, ask what to delete; if multiple matching workspaces, threads, models, agents, or messages exist, ask which one.

Before choosing workspace slugs, thread slugs, LLM providers, LLM models, or default-agent values, call `realtimex-pp-cli prepare --agent` and use exact ids from that response. Ask the user only when `prepare` returns multiple plausible matches or the requested value is not available.

For `send-llm-message`, never guess `chatProvider` or `chatModel`. Use only LLM provider/model data from `prepare.models`, `list-llm-providers`, and `list-llm-models`. Never use `prepare.agents[].models` for `send-llm-message`; those are CLI-agent/default-agent models only. Prefer provider `realtimexai` when the user did not explicitly ask for local `nodellama`, but still choose only an exact model id from the `realtimexai` LLM model list. If the user names a model that is not present in the selected provider's LLM model list, ask which available LLM model to use instead.

## Action-First API

This skill intentionally exposes a small action-first command set. Prefer these generated commands over older nested resource commands. Use `--agent` on every command.

Typical flow:

1. Prepare context:
   ```bash
   realtimex-pp-cli prepare --agent
   ```
2. Create or select exact workspace/thread slugs from `prepare`.
3. For LLM messages, use exact `chatProvider` and `chatModel` ids from `prepare.models`. Do not use `prepare.agents` here.
4. For workspace default agents, use exact `canonical` and optional `modelId` values from `prepare.agents`. Do not use `prepare.models` here.
