# Activities

> Generated workflow guide · SDK **1.7.19** · 2026-05-18

Use `sdk.activities` for activity CRUD.

Required permissions: `activities.read` and/or `activities.write`.

```js
await sdk.activities.list({ status: "pending" });
await sdk.activities.insert({ type: "note", text: "..." });
await sdk.activities.update(id, updates);
await sdk.activities.delete(id);
```
