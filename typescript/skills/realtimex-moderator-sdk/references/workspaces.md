# Workspaces And Threads

> Generated workflow guide · SDK **1.7.18** · 2026-05-18

Use this before any task that needs workspace/thread context.

Priority order:
1. Explicit user-provided workspace/thread.
2. `context.workspaceSlug` / `context.threadSlug` from `initSDK()`.
3. `RTX_WORKSPACE_SLUG` / `RTX_THREAD_SLUG` in spawned sessions.
4. List workspaces and threads, then ask only if ambiguous.

Useful calls:

```js
await sdk.api.getWorkspaces();
await sdk.api.getThreads(workspaceSlug);
await sdk.v1.workspace.listWorkspaces();
await sdk.v1.thread.listWorkspaceThreads(slug);
```
