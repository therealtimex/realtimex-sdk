---
name: realtimex-moderator-sdk
description: "Use the RealTimeX API through the generated CLI for workspace, thread, terminal-agent sessions, channel (Telegram, Zalo, Discord), skills, plugins, webhook endpoint management and delivery inspection, send messages, setup personality, heartbeat tasks operations, publish and manage artifacts, run tour guide to setup working dir."
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
  realtimex-pp-cli prepare --agent
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
* In a managed RealtimeX terminal, let `prepare` resolve the current workspace and thread from authenticated terminal-session context. Do not require or forward workspace/thread environment variables to `prepare`.
* Treat `prepare` as the resolved source of truth for requests that refer to "current workspace", "this workspace", "current thread", or "this thread".
* `RTX_AGENT_CONTEXT_JSON` and the legacy `$RTX_WORKSPACE_SLUG` and `$RTX_THREAD_SLUG` aliases may be present for runtime compatibility, but do not block on inspecting them or manually pass them to `prepare`.
* Call the following whenever you need the resolved current workspace/thread objects or related context:

  ```bash
  realtimex-pp-cli prepare --agent
  ```

* For callers outside a managed RealtimeX terminal, `prepare` still accepts explicit `--workspace-slug` and `--thread-slug` compatibility inputs.
* Ask for a missing workspace or thread only when `prepare` cannot resolve the required current context or when the user intends to target a different context.
* Always run first:

  ```bash
  realtimex-pp-cli prepare --agent
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


For `send-channel-file`:

* Use this command only from a channel-linked terminal session that has `REALTIMEX_CHANNEL_DELIVERY_CONTEXT_ID` in its environment, or when the user explicitly provides a `chdel_*` context id.
* Always pass the context explicitly. In channel-linked sessions use `--context "$REALTIMEX_CHANNEL_DELIVERY_CONTEXT_ID"`; use a literal `chdel_*` only when intentionally overriding for debugging.
* Do not infer a destination from workspace, thread, recent activity, or channel metadata.
* Send one file per command call. Repeat the command for multiple files.
* In desktop/local runtime, the CLI should send the absolute local `filePath` to the server. The server validates the path against allowed storage/temp roots before sending through the channel. Base64 upload is fallback transport, not the preferred path.
* The server validates the delivery context, active channel session, plugin state, runtime binding when supplied, and file size/type handling before delivery.

For webhook endpoint management:

* These operations require an authenticated, user-bound session credential.
* Treat `secret` as write-only input for creation or rotation. Never expect, request, print, or persist a plaintext secret from endpoint responses.
* Use `list-webhook-deliveries` for bounded metadata inspection. Raw request headers, signatures, bodies, and normalized payload fields are intentionally unavailable.
* Pass `confirmDestructive=true` only after the user has explicitly requested permanent endpoint deletion.

For workspace default-agent setup:

* Use `prepare.agents` only.
* Use exact agent `canonical` and optional agent `modelId` values from `prepare.agents`.
* Never use `prepare.models` for workspace default-agent setup.

For terminal agents and terminal sessions:

* Use `list-terminal-agents` when you only need available terminal agents. Use `prepare` when you also need workspace/thread/provider/model context.
* Use `open-terminal-session` to open a new desktop terminal session for a terminal agent. It auto-attaches the CLI controller through the desktop runtime launch request.
* Use exact `agentName`, `providerId`, and `modelId` values from `list-terminal-agents` or `prepare.agents`.
* When opening a terminal session for the current thread, pass the exact current workspace and thread slugs returned by `prepare`.
* Use `list-terminal-sessions` to inspect grouped terminal sessions by `workspaceSlug` and `threadSlug`. Each session includes compact identity fields and `attached` status.
* Use `resume-terminal-session` or `resume-latest-terminal-session` to resume + attach an existing session. Use `terminate-terminal-session` to close + detach a session.

For agent skills:

* Use `list-workspace-agent-skills` before enabling, disabling, or reloading workspace skills.
* For `reload-agent-skills`, always pass a workspace slug.
* If the user asks to reload skills for the current workspace, pass the exact current workspace slug returned by `prepare`.
* After `reload-agent-skills` succeeds, reload your own skill context before relying on updated skill instructions.

For personality and heartbeat setup:

* Use `setup-personality` to get the target directory for workspace or global personality files.
* Start from `templates/AGENTS.template.md` when creating `AGENTS.md`.
* Make `CLAUDE.md` a symlink to `AGENTS.md`.
* Use `setup-heartbeat-tasks` to get the target `HEARTBEAT.md` path.
* Start from `templates/HEARTBEAT.template.md` when creating `HEARTBEAT.md`.
* Keep heartbeat instructions separate from personality files.

For `setup-working-dir` and `run-automation-workflow*`:

* Never auto retry on error code 500 or timeout, just inform error to user

For `publish-artifact`:

* files or folders have to be placed in <working-dir>/artifacts/ to be able to published
