# Permissions

> Generated workflow guide · SDK **1.7.22** · 2026-05-29

LocalApps using `x-app-id` must request permissions before calling protected SDK routes.

| Permission | Use For |
|---|---|
| `api.agents` | List agents |
| `api.workspaces` | List workspaces |
| `api.threads` | List workspace threads |
| `api.task` | Read task status |
| `activities.read` | Read activities |
| `activities.write` | Create/update/delete activities |
| `llm.chat` | LLM chat and streaming chat |
| `llm.embed` | Generate embeddings |
| `llm.providers` | List LLM/embed providers |
| `vectors.read` | Query/list vector stores |
| `vectors.write` | Upsert/delete vectors |
| `mcp.servers` | List MCP servers |
| `mcp.tools` | List/execute MCP tools |
| `acp.agent` | ACP agent sessions |
| `desktop.runtime-sessions` | Visible Electron terminal sessions |
| `desktop.browser` | RealTimeX Browser sessions and tabs |
| `channels.manage` | External chat channel setup and administration |
| `tts.generate` | Text-to-speech |
| `stt.listen` | Speech-to-text |
| `credentials.read` | Read stored credentials |

API-key dev mode has wildcard access.
