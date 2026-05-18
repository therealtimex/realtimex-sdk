---
name: realtimex-moderator-sdk
description: Control and interact with the RealTimeX application through its Node.js SDK. Use this skill for workspaces, threads, agents, activities, LLM chat, vector store, MCP tools, ACP sessions, desktop terminal/browser sessions, chat channels, TTS/STT, and other RealTimeX platform APIs. Detailed workflows live in references/*.md.
generated: 2026-05-18
sdk_version: 1.7.18
---

# RealTimeX Moderator SDK

Interact with the RealTimeX platform (`http://localhost:3001`) using `@realtimex/sdk` **v1.7.18**. Authentication is automatic when running inside RealTimeX.

`<SKILL_DIR>` below means this skill directory.

## Start Here

Use the bundled CLI for quick checks:

```bash
SKILL=<SKILL_DIR>/scripts/rtx.js
ENV=--env-dir=<cwd>

node "$SKILL" ping $ENV
node "$SKILL" context $ENV
node "$SKILL" workspaces $ENV
node "$SKILL" threads <workspace-slug> $ENV
node "$SKILL" agents $ENV
node "$SKILL" help
```

Use a custom script when workflow logic is needed:

```js
const { initSDK } = require('<SKILL_DIR>/scripts/lib/sdk-init');
const { sdk, context } = await initSDK();
// See references/*.md and references/api-reference/index.md
```

Scripts using the SDK must exit explicitly with `process.exit(0)` or `process.exit(1)` so open HTTP sockets do not keep the process alive.

## Task Routing

Open the smallest relevant reference before acting:

| Task | Reference |
|---|---|
| Setup, auth, script basics | `references/quickstart.md` |
| Permission names and LocalApp grants | `references/permissions.md` |
| Workspace/thread selection | `references/workspaces.md` |
| Trigger agents or manage agent sessions | `references/agents.md` |
| Launch visible Electron terminal sessions | `references/terminal-sessions.md` |
| Manage RealTimeX Browser sessions/tabs | `references/browser.md` |
| Configure Telegram/Zalo/WhatsApp/etc. channels | `references/channels.md` |
| LLM chat, embeddings, vector store | `references/llm.md` |
| MCP server/tool access | `references/mcp.md` |
| Activities CRUD | `references/activities.md` |
| Full generated API index | `references/api-reference/index.md` |
| Database/schema concepts | `references/app-concepts.md` |
| Source-detected pitfalls | `references/known-issues.md` |

## Workspace And Thread Rule

When a task needs workspace/thread context:

1. Check current context first with `node "$SKILL" context $ENV` or `const { sdk, context } = await initSDK()`.
2. Use explicit user-provided workspace/thread values when present.
3. Otherwise use `context.workspaceSlug` and `context.threadSlug` when available.
4. If still unknown, list workspaces and threads, then ask only if ambiguous.

Do not guess a workspace or thread.

## Critical Routing Rules

- Visible terminal work: use `sdk.desktopRuntimeSessions.*`, not ACP, unless the user explicitly asks for headless ACP.
- RealTimeX Browser work: use `sdk.desktopBrowser.*` for session/tab control, then use the `agent-browser` skill against the CDP port for page interaction.
- External chat channels: use `sdk.v1.channels.*` and require the `channels.manage` permission for LocalApps using `x-app-id`.
- Generated v1 APIs are documented under `references/api-reference/*.md`; prefer the topic guide first, then the API file for exact signatures.

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

See `references/known-issues.md` for evidence and corrected usage.
