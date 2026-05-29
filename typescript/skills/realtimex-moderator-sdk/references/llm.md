# LLM And Vector Store

> Generated workflow guide · SDK **1.7.22** · 2026-05-29

Use `sdk.llm` for chat, streaming, embeddings, and vector helpers.

Common permissions: `llm.chat`, `llm.embed`, `llm.providers`, `vectors.read`, `vectors.write`.

```js
await sdk.llm.chat([{ role: "user", content: "Hello" }]);
await sdk.llm.embed(["text to embed"]);
await sdk.llm.vectors.query(vector, { workspaceId });
```
