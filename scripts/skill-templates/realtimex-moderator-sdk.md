---
name: realtimex-moderator-sdk
description: "Use the RealTimeX API through the generated CLI for workspace, thread, channel (Telegram, Zalo, Discord), skills, plugins and send messages, setup personality, heartbeat tasks operations."
argument-hint: "<command> [args] | install cli"
---

## Prerequisites: Install the CLI

This skill drives the `realtimex-pp-cli` binary. Verify the CLI is installed and exactly matches this skill's SDK version before invoking any command from this skill. If it is missing or the version does not match, reinstall the pinned version first:

1. Install or reinstall the pinned version via npm:
   ```bash
   npm install -g @realtimex/pp-cli@${SDK_VERSION}
   ```
2. Verify the exact version:
   ```bash
   realtimex-pp-cli --version
   ```
   The output must be `realtimex-pp-cli ${SDK_VERSION}`.

If `--version` reports "command not found" after install, the npm global bin directory is not on `$PATH`. If it reports any version other than `${SDK_VERSION}`, reinstall with the pinned npm command above. Do not proceed with skill commands until exact-version verification succeeds.

* Always run first:

  ```bash
  realtimex-pp-cli prepare --workspace-slug "$RTX_WORKSPACE_SLUG" --thread-slug "$RTX_THREAD_SLUG" --agent
  ```

## Direct Use

1. Check whether the CLI is installed and version-matched:
   ```bash
   realtimex-pp-cli --version
   ```
   If the command is missing or the output is not exactly `realtimex-pp-cli ${SDK_VERSION}`, reinstall the pinned version:
   ```bash
   npm install -g @realtimex/pp-cli@${SDK_VERSION}
   ```
   Then run `realtimex-pp-cli --version` again and proceed only after exact-version verification succeeds.
2. Match the user query to the best command from the Unique Capabilities and Command Reference above.
3. Execute with the `--agent` flag:
   ```bash
   realtimex-pp-cli <command> [subcommand] [args] --agent
   ```
4. If ambiguous, drill into subcommand help: `realtimex-pp-cli <command> --help`.

## Constraints

This skill intentionally exposes a small action-first command set. Prefer these generated commands over older nested resource commands.

* Use only documented `realtimex-pp-cli` commands.
* Never call the RealTimeX API directly with `curl`, `fetch`, raw HTTP clients, or custom scripts.
* If the current CLI cannot do the requested task, say the feature is not available and will be added soon.
* Use `--agent` on every command.
* Always run first:

  ```bash
  realtimex-pp-cli prepare --workspace-slug "$RTX_WORKSPACE_SLUG" --thread-slug "$RTX_THREAD_SLUG" --agent
  ```

* Use exact workspace slugs, thread slugs, provider ids, model ids, agent `canonical`, and agent `modelId` values from `prepare`.
* Do not guess workspace, thread, model, provider, agent, message, target, or option values.
* If required context is missing or ambiguous, ask a concise clarification question before running a command.
* Never assume a workspace or thread that the user has not referenced.
* If the user does not name or contextually reference a workspace for a workspace/thread/message operation, ask which workspace to use before running a command.
* If the user names or contextually references a thread but does not name or contextually reference its workspace, ask which workspace contains that thread before running a command.
* When the user explicitly uses contextual references such as "current workspace", "this thread", "the thread just created", "that workspace", or similar references, resolve them from the available conversation context only when the reference is unambiguous.
* If multiple plausible matches exist, ask the user to choose.

For `send-message`:

* Require these values to be explicitly named or explicitly referenced in the current request:
  * workspace
  * thread
  * message
* If any of those values are missing or ambiguous, ask for the missing values before running the command.
* Do not provide LLM provider/model arguments to `send-message`; the server routes the message based on the thread/workspace configuration.

For workspace default-agent setup:

* Use `prepare.agents` only.
* Use exact agent `canonical` and optional agent `modelId` values from `prepare.agents`.
* Never use `prepare.models` for workspace default-agent setup.

For agent skills:

* Use `list-workspace-agent-skills` before enabling, disabling, or reloading workspace skills.
* For `reload-agent-skills`, always pass a workspace slug.
* If the user asks to reload skills for the current workspace, pass `--workspace-slug "$RTX_WORKSPACE_SLUG"`.
* After `reload-agent-skills` succeeds, reload your own skill context before relying on updated skill instructions.

For personality and heartbeat setup:

* Use `setup-personality` to get the target directory for workspace or global personality files.
* Start from `templates/AGENTS.template.md` when creating `AGENTS.md`.
* Make `CLAUDE.md` a symlink to `AGENTS.md`.
* Use `setup-heartbeat-tasks` to get the target `HEARTBEAT.md` path.
* Start from `templates/HEARTBEAT.template.md` when creating `HEARTBEAT.md`.
* Keep heartbeat instructions separate from personality files.
