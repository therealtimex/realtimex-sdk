---
name: realtimex-moderator-sdk
description: Control and interact with the RealTimeX application through its Node.js SDK. This skill should be used when users want to manage workspaces, threads, agents, activities, LLM chat, vector store, MCP tools, ACP agent sessions, TTS/STT, or any other RealTimeX platform feature via the API. All method signatures are verified against the SDK source code.
generated: 2026-03-24
sdk_version: 1.4.0
---

# RealTimeX Moderator (SDK Source-Verified)

Interact with the RealTimeX desktop app (`http://localhost:3001`) using `@realtimex/sdk` **v1.4.0** in Developer Mode (API Key).

> Auto-generated from the `@realtimex/sdk` TypeScript source.
> Refresh: `node scripts/generate-skill.mjs --force` from the SDK repo root.

---

## API Key Resolution

Handled automatically by `scripts/lib/sdk-init.js` — priority order:
1. `REALTIMEX_API_KEY` / `REALTIMEX_AI_API_KEY` in `<cwd>/.env`
2. `RTX_API_KEY` / `REALTIMEX_API_KEY` / `REALTIMEX_AI_API_KEY` from `process.env`
3. Interactive readline prompt

`<SKILL_DIR>` below refers to the directory containing this SKILL.md.

---

## Option A — Bundled CLI

```bash
SKILL=<SKILL_DIR>/scripts/rtx.js
ENV=--env-dir=<cwd>

node "$SKILL" ping                                     $ENV
node "$SKILL" agents                                   $ENV
node "$SKILL" workspaces                               $ENV
node "$SKILL" threads <workspace-slug>                 $ENV
node "$SKILL" trigger-agent <agent> <workspace> <msg>  $ENV
node "$SKILL" acp-chat qwen "question" --cwd=<path>    $ENV
node "$SKILL" llm-chat "message"                       $ENV
node "$SKILL" activities --status=pending              $ENV
node "$SKILL" mcp-servers                              $ENV
node "$SKILL" help
```

## Option B — Custom script

```js
const { initSDK } = require('<SKILL_DIR>/scripts/lib/sdk-init');
const { sdk, apiKey } = await initSDK({ envDir: process.cwd() });
// All SDK APIs — see references/api-reference.md
```

---

## Critical Rules (source-detected)

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

Full fixes in `references/known-issues.md`.

---

## Key Facts

- **Metadata methods** (`getAgents`, `getWorkspaces`, etc.) live on `sdk.api.*`, not `sdk.*`
- **`sdk.webhook.triggerAgent()`** sends wrong event type — always use raw fetch with `event: "trigger-agent"`
- **`sdk.task`** methods: `start(uuid)`, `complete(uuid, result)`, `fail(uuid, "error")` — positional args
- **ACP sessions** need `approvalPolicy: 'approve-all'` for autonomous scripts
- **SDK env vars:** `RTX_API_KEY` (dev), `RTX_APP_ID` (prod), `RTX_APP_NAME`

## References

- `references/api-reference.md` — all class methods (auto-generated from source)
- `references/known-issues.md` — verified source mismatches (auto-generated)
