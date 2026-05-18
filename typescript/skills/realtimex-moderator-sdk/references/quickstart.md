# Quickstart

> Generated workflow guide · SDK **1.7.19** · 2026-05-18

Use this when starting any SDK task.

```js
const { initSDK } = require('<SKILL_DIR>/scripts/lib/sdk-init');
const { sdk, context } = await initSDK();
```

Rules:
- Use the working directory or system temp for helper scripts, never the skill directory.
- Exit scripts explicitly with `process.exit(0)` or `process.exit(1)`.
- Check `context.workspaceSlug` and `context.threadSlug` before asking the user.
- For exact signatures, open `references/api-reference/index.md`.
