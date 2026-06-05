# RealtimeX SDK Release Log

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
