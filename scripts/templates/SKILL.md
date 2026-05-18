---
name: realtimex-moderator-sdk
description: Control and interact with the RealTimeX application through its Node.js SDK. Use for workspaces, threads, agents, activities, LLM chat, vector store, MCP tools, ACP sessions, desktop terminal/browser sessions, chat channels, TTS/STT, and other RealTimeX platform APIs. Load detailed version-matched instructions with `rtx.js skills get <topic>`.
generated: {{DATE}}
sdk_version: {{SDK_VERSION}}
---

# RealTimeX Moderator SDK

SDK-backed control of the local RealTimeX platform (`http://localhost:3001`) using `@realtimex/sdk` **v{{SDK_VERSION}}**.

This file is the discovery stub. Load workflow content from the bundled CLI so instructions match the installed SDK version.

`<SKILL_DIR>` below means this skill directory.

## Start Here

```bash
SKILL=<SKILL_DIR>/scripts/rtx.js
ENV=--env-dir=<cwd>

node "$SKILL" skills get core $ENV
node "$SKILL" skills get core --full $ENV
```

The CLI serves skill content generated from the installed SDK source and generated references.

## Specialized Skills

Load the smallest relevant topic before acting:

```bash
node "$SKILL" skills list $ENV
node "$SKILL" skills get workspaces $ENV
node "$SKILL" skills get agents $ENV
node "$SKILL" skills get terminal $ENV
node "$SKILL" skills get browser $ENV
node "$SKILL" skills get channels $ENV
node "$SKILL" skills get llm $ENV
node "$SKILL" skills get mcp $ENV
node "$SKILL" skills get activities $ENV
node "$SKILL" skills get api:v1-channels --full $ENV
```

File fallback is also available under `references/`, especially:

- `references/quickstart.md`
- `references/permissions.md`
- `references/workspaces.md`
- `references/browser.md`
- `references/channels.md`
- `references/api-reference/index.md`

## Quick Commands

```bash
node "$SKILL" ping $ENV
node "$SKILL" context $ENV
node "$SKILL" workspaces $ENV
node "$SKILL" threads <workspace-slug> $ENV
node "$SKILL" agents $ENV
node "$SKILL" help
```

For custom scripts:

```js
const { initSDK } = require('<SKILL_DIR>/scripts/lib/sdk-init');
const { sdk, context } = await initSDK();
```

Scripts using the SDK must exit explicitly with `process.exit(0)` or `process.exit(1)`.

## Critical Routing Rules

- Visible terminal work: load `skills get terminal`; use `sdk.desktopRuntimeSessions.*`, not ACP, unless the user explicitly asks for headless ACP.
- RealTimeX Browser work: load `skills get browser`; use `sdk.desktopBrowser.*` for session/tab control, then use `agent-browser` against the CDP port for page interaction.
- External chat channels: load `skills get channels`; use `sdk.v1.channels.*`; LocalApps using `x-app-id` need `channels.manage`.
- Workspace/thread context: load `skills get workspaces`; do not guess workspace/thread when context is unknown.

## Known Source Issues

{{RULES_TABLE}}

For evidence and corrected usage:

```bash
node "$SKILL" skills get known-issues $ENV
```
