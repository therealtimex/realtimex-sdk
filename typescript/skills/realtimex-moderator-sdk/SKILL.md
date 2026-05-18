---
name: realtimex-moderator-sdk
description: Control and interact with the RealTimeX application through its Node.js SDK. Use for workspaces, threads, agents, activities, LLM chat, vector store, MCP tools, ACP sessions, desktop terminal/browser sessions, chat channels, TTS/STT, and other RealTimeX platform APIs. Load detailed version-matched instructions with `rtx.js skills get <topic>`.
generated: 2026-05-18
sdk_version: 1.7.19
---

# RealTimeX Moderator SDK

SDK-backed control of the local RealTimeX platform (`http://localhost:3001`) using `@realtimex/sdk` **v1.7.19**.

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

| # | Issue |
|---|-------|
| 1 | 'sdk.webhook.triggerAgent()' sends 'event: "task.trigger"' — server expects '"trigger-agen |
| 2 | 'sdk.task.start/complete/fail' take positional '(taskUuid, ...)' — NOT '{ task_uuid }' obj |
| 3 | 'sdk.activities.list()' returns 'Activity[]' directly — NOT '{ activities: [...] }' |
| 4 | 'sdk.llm.chat()' response is 'res.response?.content' — NOT 'choices[0].message.content' |
| 5 | 'sdk.llm.chatStream()' yields 'chunk.textResponse' — NOT 'choices[0].delta.content' |
| 6 | 'sdk.llm.embedAndStore()' takes '{ texts: string[], documentId?, workspaceId?, ... }' — NO |
| 7 | 'sdk.llm.vectors.query()' takes a raw 'number[]' embedding — NOT a text string |
| 8 | 'sdk.llm.vectors.delete()' requires '{ deleteAll: true }' — delete-by-ID not supported |
| 9 | 'sdk.mcp.getServers()' takes a plain string — NOT '{ provider: "all" }' |
| 10 | 'getAgents/getWorkspaces/getThreads/getTask' live on 'sdk.api.*' — NOT directly on 'sdk.*' |
| 11 | ACP 'streamChat' uses named SSE ('event:' line); 'text_delta.data.type === "thinking"' = i |
| 12 | ACP sessions stall without 'approvalPolicy: "approve-all"' when tools need permission |

For evidence and corrected usage:

```bash
node "$SKILL" skills get known-issues $ENV
```
