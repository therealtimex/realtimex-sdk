# RealtimeX SDK Release Log

## 2.0.9 - 2026-06-05

This release adds a CLI action for forcing workspace agent skills to be reloaded from the app, and updates the generated moderator skill guidance for that flow.

Install the matching CLI:

```bash
npm install -g @realtimex/pp-cli@2.0.9
realtimex-pp-cli --version
```

The version output should be:

```text
realtimex-pp-cli 2.0.9
```

### New: Reload Workspace Agent Skills

- `reload-agent-skills` - Force reload enabled agent skills into a workspace working directory.

When reloading the current workspace, pass:

```bash
realtimex-pp-cli reload-agent-skills --workspace-slug "$RTX_WORKSPACE_SLUG" --agent
```

After files are reloaded, the running agent must reload its own skill context before relying on updated skill instructions. The command updates the workspace skill files on disk; it does not automatically refresh the currently running agent process.

### Updated: Moderator Skill Guidance

The generated `realtimex-moderator-sdk` skill now tells agents to:

- Use `list-workspace-agent-skills` before enabling, disabling, or reloading workspace skills.
- Always pass a workspace slug to `reload-agent-skills`.
- Use `--workspace-slug "$RTX_WORKSPACE_SLUG"` when the user asks to reload skills for the current workspace.
- Reload their own skill context after `reload-agent-skills` succeeds.

## 2.0.8 - 2026-06-05

This release adds first-class CLI controls for RealTimeX agent skills and plugins. Agents can now inspect which skills/plugins are available, enable or disable workspace skills, and manage plugin runtime state without calling raw API endpoints.

Install the matching CLI:

```bash
npm install -g @realtimex/pp-cli@2.0.8
realtimex-pp-cli --version
```

The version output should be:

```text
realtimex-pp-cli 2.0.8
```

### New: Agent Skill Controls

Agent skills are now exposed as CLI commands instead of requiring agents to inspect workspace config JSON manually.

- `list-agent-skills` - List published agent skills.
- `list-workspace-agent-skills <workspaceSlug>` - List published agent skills with enabled/disabled state for one workspace.
- `enable-workspace-agent-skill <workspaceSlug> <skillId>` - Enable one agent skill in a workspace.
- `disable-workspace-agent-skill <workspaceSlug> <skillId>` - Disable one agent skill in a workspace.

Use exact skill ids, names, or display names from `list-workspace-agent-skills`. Workspace enable/disable updates the same `disabledAgentSkills` config used by the app UI.

### New: Plugin Runtime Controls

Installed plugins are now manageable from the CLI with compact status output suitable for agents.

- `list-plugins` - List installed plugins with enabled state and runtime load status.
- `enable-plugin <pluginId>` - Enable one installed plugin globally and load it into runtime.
- `disable-plugin <pluginId>` - Disable one installed plugin globally and unload it from runtime.
- `reload-plugin <pluginId>` - Reload one enabled plugin in runtime.

Use exact plugin ids, names, or display names from `list-plugins`. The list response includes runtime status so agents can tell whether a plugin is loaded or unloaded.

### New: Personality And Heartbeat Setup

The generated skill now has clearer guidance for agent-authored workspace files:

- `setup-personality` - Return the path and concise instructions for workspace or global personality markdown files such as `AGENTS.md` and `CLAUDE.md`.
- `setup-heartbeat-tasks` - Return the path and concise instructions for workspace or global `HEARTBEAT.md` task setup.

The generated skill package also includes reusable templates:

- `templates/AGENTS.template.md`
- `templates/HEARTBEAT.template.md`

### New: Heartbeat Configuration Commands

Heartbeat app settings are now available as small CLI actions:

- `set-heartbeat-enabled`
- `set-heartbeat-interval`
- `set-heartbeat-active-hours`
- `set-heartbeat-timezone`
- `set-heartbeat-auto-pilot`
- `set-heartbeat-default-agent`

`set-heartbeat-default-agent` supports the same terminal agent shape used by workspace default agents.

### New: Terminal Agent Reasoning Effort

Workspace and heartbeat default-agent setup now support a flat `reasoning_effort` parameter for terminal models that expose this runtime option.

- `set-workspace-default-agent <workspaceSlug>`
- `set-heartbeat-default-agent`

The CLI accepts `reasoning_effort` directly and the app persists it internally as `agent.acp.runtimeOptionValues.reasoning_effort`.

### Existing Action-First Commands

The 2.0.8 CLI still includes the existing action-first command set from 2.0.7:

- Context: `prepare`
- Workspace: `list-workspaces`, `create-workspace`, `get-workspace`, `rename-workspace`, `delete-workspace`, `set-workspace-default-agent`, `clear-workspace-default-agent`
- Threads: `list-threads`, `create-thread`, `get-thread`, `rename-thread`, `delete-thread`, `send-message`
- LLM: `list-llm-providers`, `list-llm-models`
- Channels: `list-channels`, `create-channel`, `update-channel`, `start-channel`, `stop-channel`, `delete-channel`, `approve-channel-pairing-code`

Use `--agent` on every command when automating with agents.

## 2.0.7 - 2026-06-04

This release focuses on the generated `realtimex-pp-cli` package and the RealtimeX moderator skill. The CLI is generated from the checked-in `openapi.json` and exposes a small flat command set for workspace, thread, LLM, and channel operations.

Install the matching CLI:

```bash
npm install -g @realtimex/pp-cli@2.0.7
realtimex-pp-cli --version
```

The version output should be:

```text
realtimex-pp-cli 2.0.7
```

Use agent-safe mode for automation:

```bash
realtimex-pp-cli <command> [args] --agent
```

### Context

- `prepare` - Return compact workspace, thread, LLM provider/model, and CLI agent context.

Recommended agent usage:

```bash
realtimex-pp-cli prepare --workspace-slug "$RTX_WORKSPACE_SLUG" --thread-slug "$RTX_THREAD_SLUG" --agent
```

### Workspace Commands

- `list-workspaces` - List all workspaces visible to the current API caller.
- `create-workspace` - Create a workspace.
  - Required body/flag: `name`
- `get-workspace <workspaceSlug>` - Get one workspace by exact workspace slug.
- `rename-workspace <workspaceSlug>` - Rename one workspace.
  - Required body/flag: `name`
- `delete-workspace <workspaceSlug>` - Delete one workspace.
- `set-workspace-default-agent <workspaceSlug>` - Set the default CLI agent for a workspace.
  - Required body/flag: `canonical`
  - Optional body/flags: `providerId`, `modelId`
  - Use exact agent values from `prepare.agents`.
- `clear-workspace-default-agent <workspaceSlug>` - Clear the default CLI agent from a workspace.

### Thread Commands

- `list-threads <workspaceSlug>` - List threads for one exact workspace slug.
- `create-thread <workspaceSlug>` - Create a thread in one workspace.
  - Optional body/flag: `name`
- `get-thread <workspaceSlug> <threadSlug>` - Get one thread by exact workspace slug and exact thread slug.
- `rename-thread <workspaceSlug> <threadSlug>` - Rename one thread.
  - Required body/flag: `name`
- `delete-thread <workspaceSlug> <threadSlug>` - Delete one thread.
- `send-message <workspaceSlug> <threadSlug>` - Send one message to a thread.
  - Required body/flag: `message`
  - Optional body/flags: `attachments`, `webSearchEnabled`, `broadcastThreadEvents`, `stripAgentPrefixForDelivery`, `channelTurnId`
  - Uses the same routing as channel replies: terminal-agent threads dispatch to terminal runtime, other threads use configured LLM chat.

### LLM Commands

- `list-llm-providers` - List supported LLM providers.
- `list-llm-models <provider>` - List models for one provider id.

Use exact provider and model ids returned by these commands when configuring LLM settings.

### Channel Commands

- `list-channels` - List configured chat channels.
- `create-channel <workspaceSlug>` - Create a chat channel in one workspace.
  - Supported flat channel types: `telegram`, `discord`, `zalo`
  - Defaults to `telegram` when channel type is omitted.
  - Common body/flags: `name`, `plugin_type`, `channelType`, `type`, `botToken`, `thread_id`, `threadId`, `autoStart`
  - `botToken` is required for `telegram`, `discord`, and `zalo`.
  - `thread_id` is optional.
- `update-channel <channelId>` - Update one chat channel.
  - Common body/flags: `name`, `thread_id`, `threadId`, `terminalProgressRelay`, `terminalProgressThrottleSeconds`, `ttsEnabled`, `tts_enabled`
  - Only channel writable fields are changed.
- `start-channel <channelId>` - Start one chat channel.
- `stop-channel <channelId>` - Stop one chat channel.
- `delete-channel <channelId>` - Delete one chat channel.
- `approve-channel-pairing-code <code>` - Approve one pending channel pairing code.
  - Accepts visible 6-digit code or database id.
  - Works for `telegram`, `discord`, and `zalo` pairing requests.

### Notes For Agents

- Use only documented `realtimex-pp-cli` commands.
- Do not call the RealtimeX API directly with `curl`, `fetch`, raw HTTP clients, or custom scripts.
- Always run `prepare` before choosing workspace, thread, provider, model, or agent values.
- Do not guess workspace, thread, model, provider, agent, message, target, or option values.
- If required context is missing or ambiguous, ask a concise clarification question first.
- Use `--agent` on every CLI command.
