# RealtimeX App Concepts

---

> Auto-generated from app source code. Do not edit manually.

---

> Sources: Prisma schema, model files, personalityStorage.js

---

## Personality

The **Personality** system stores per-agent and per-workspace configuration as markdown files.
Files live in `storage/working-data/agent-heartbeat/` (global) or `storage/working-data/<workspace-slug>/` (workspace-level).

### File Structure

| File | Purpose |
|---|---|
| `AGENTS.md` | Operating instructions for the agent |
| `SOUL.md` | Persona, tone, and boundaries |
| `USER.md` | Who the user is and how to address them |
| `IDENTITY.md` | The agent's name, vibe, and emoji |
| `TOOLS.md` | Notes on local tools |
| `MEMORY.md` | Curated long-term memory |
| `HEARTBEAT.md` | Ambient agent standing instructions |
| `memory/` | Daily memory logs (YYYY-MM-DD.md) |
| `skills/` | Workspace-specific skills |
| `canvas/` | Canvas UI files |

Personality files are editable via the Personality editor in the UI or directly through the `/api/personality-files` endpoints.

---

## Heartbeat

**Heartbeat** is the ambient background agent system. It runs an AI agent on a schedule to proactively
monitor context (calendar, documents, threads) and take autonomous actions.

### How It Works

1. A scheduler triggers runs based on `every` cadence (e.g. `"30m"`, `"1h"`).
2. Each run provisions an agent (default: RealTimeX Ambient Agent based on Qwen CLI).
3. The agent reads Personality files, the heartbeat queue, and calendar events.
4. Results are stored in the week's thread inside the `agent_heartbeat` workspace.

### Configuration (`heartbeat_config` in system_settings)

| Field | Default | Description |
|---|---|---|
| `enabled` | `false` | — |
| `every` | `"30m"` | The frontend hydrates new configs with the user's system timezone. |
| `timezone` | `null` | — |
| `llmProvider` | `DEFAULT_AMBIENT_LLM_PROVIDER` | — |
| `llmModel` | `DEFAULT_AMBIENT_LLM_MODEL` | autoPilotEnabled: when true, the CLI ACP agent will automatically select |
| `autoPilotEnabled` | `false` | — |

### Calendar Routines

Heartbeat can integrate with calendar events via these routines:
- **`morningBrief`** — Runs at start of day to summarize upcoming meetings
- **`preMeetingPrep`** — Runs before a meeting to prepare context
- **`followUpSuggestions`** — Runs after a meeting to suggest follow-up actions

### Heartbeat Queue

The `heartbeat_queue` table stores text items (documents, messages, events) that the agent consumes on the next run. Items are drained after consumption.

---

## Workspace

A **Workspace** is the core unit of organisation in RealtimeX. It combines a document store (vector DB),
LLM configuration, agent settings, and a chat interface.

### Workspace Types

| Type | Description |
|---|---|
| `default` | Standard RAG chat workspace with documents and LLM |
| `meeting_minutes` | Workspace focused on meeting recording and transcription |
| `agent_skills` | Workspace used to host and develop agent skills |
| `agent_heartbeat` | Special system workspace for the ambient heartbeat agent |

### Chat Modes

| Mode | Description |
|---|---|
| `chat` | Full conversational mode — uses document context + LLM history |
| `query` | Query-only mode — each message is independent, no history |

### Web Search Providers

Available values for `webSearchProvider`: `duckduckgo`, `google`, `bing`, `tavily`, `brave`, `brave-api`, `startpage`, `searxng`

### Key Settings

| Setting | Description |
|---|---|
| `openAiPrompt` | System prompt sent to the LLM |
| `chatProvider` / `chatModel` | LLM provider and model for chat |
| `similarityThreshold` | Minimum similarity score for document retrieval (0–1, default 0.25) |
| `topN` | Number of document chunks to retrieve per query (default 4) |
| `vectorSearchMode` | `default` or `rerank` |
| `webSearchEnabled` | Whether to augment responses with live web search |
| `ambientAgentProvider` / `ambientAgentModel` | Override LLM for ambient agent in this workspace |
| `ambientAgentSystemPrompt` | Custom system prompt for the ambient agent in this workspace |

---

## Agent Skills

An **Agent Skill** is a tool-set (a `SKILL.md` + scripts folder) that agents can invoke.
Skills are loaded from git repositories, zip files, or installed plugins.

### Skill Types

| Type | Description |
|---|---|
| `repo` | Skill loaded from a git repository URL |
| `zip` | Skill loaded from an uploaded .zip file |

### Skill Scopes

| Scope | Description |
|---|---|
| `global` | Available to all workspaces and users |
| `workspace` | Scoped to a specific workspace |
| `local-app` | Provided by a registered LocalApp (SDK) |
| `uploaded` | Manually uploaded by a user |
| `plugin` | Bundled with an installed plugin (read-only) |

### Skill Status

Valid values: `draft`, `published`

---

## Data Models

The following models are stored in the RealtimeX database (Prisma / SQLite or PostgreSQL).

### ApiKey (`api_keys`)
A Bearer API key for authenticating v1 API and SDK requests.

| Field | Type | Default | Notes |
|---|---|---|---|
| `secret` | String? | — | — |

### WorkspaceDocument (`workspace_documents`)
A document embedded into a workspace's vector store for RAG.

| Field | Type | Default | Notes |
|---|---|---|---|
| `docId` | String | — | — |
| `filename` | String | — | — |
| `docpath` | String | — | — |
| `workspaceId` | Int | — | — |
| `metadata` | String? | — | — |
| `pinned` | Boolean? | false | — |
| `watched` | Boolean? | false | — |
| `workspace` | workspaces | — | — |
| `document_sync_queues` | document_sync_queues? | — | — |

### invites (`invites`)
| Field | Type | Default | Notes |
|---|---|---|---|
| `code` | String | — | — |
| `email` | String? | — | — |
| `name` | String? | — | — |
| `message` | String? | — | — |
| `role` | String? | — | — |
| `status` | String | pending | — |
| `claimedBy` | Int? | — | — |
| `workspaceIds` | String? | — | — |
| `webhookStatus` | String? | — | — |
| `webhookError` | String? | — | — |

### system_settings (`system_settings`)
| Field | Type | Default | Notes |
|---|---|---|---|
| `label` | String | — | — |
| `value` | String? | — | — |

### User (`users`)
A platform user account.

| Field | Type | Default | Notes |
|---|---|---|---|
| `username` | String? | — | — |
| `name` | String? | — | — |
| `kc_user_id` | String? | — | — |
| `email` | String? | — | — |
| `password` | String? | — | — |
| `pfpFilename` | String? | — | — |
| `role` | String | default | — |
| `suspended` | Int | 0 | — |
| `seen_recovery_codes` | Boolean? | false | — |
| `dailyMessageLimit` | Int? | — | — |
| `bio` | String? |  | — |
| `workspace_chats` | workspace_chats[] | — | — |
| `workspace_users` | workspace_users[] | — | — |
| `created_workspaces` | workspaces[] | — | — |
| `embed_configs` | embed_configs[] | — | — |
| `embed_chats` | embed_chats[] | — | — |
| `threads` | workspace_threads[] | — | — |
| `recovery_codes` | recovery_codes[] | — | — |
| `password_reset_tokens` | password_reset_tokens[] | — | — |
| `workspace_agent_invocations` | workspace_agent_invocations[] | — | — |
| `slash_command_presets` | slash_command_presets[] | — | — |
| `system_prompt_presets` | system_prompt_presets[] | — | — |
| `temporary_auth_tokens` | temporary_auth_tokens[] | — | — |
| `system_prompt_variables` | system_prompt_variables[] | — | — |
| `prompt_history` | prompt_history[] | — | — |
| `desktop_mobile_devices` | desktop_mobile_devices[] | — | — |
| `workspace_parsed_files` | workspace_parsed_files[] | — | — |
| `workspace_tasks` | workspace_tasks[] | — | — |
| `agent_working_directories` | agent_working_directories[] | — | — |

### agent_working_directories (`agent_working_directories`)
| Field | Type | Default | Notes |
|---|---|---|---|
| `user_id` | Int | — | — |
| `path` | String | — | — |
| `description` | String? | — | — |
| `workspace_ids` | String? | — | JSON array of workspace ID strings; NULL = all workspaces |
| `agent_names` | String? | — | JSON array of agent name strings; NULL = all agents |
| `user` | users | — | — |

### Workspace (`workspaces`)
A chat/knowledge space with its own documents, LLM config, and agent settings.

| Field | Type | Default | Notes |
|---|---|---|---|
| `name` | String | — | — |
| `slug` | String | — | — |
| `share_token` | String? | — | — |
| `vectorTag` | String? | — | — |
| `openAiTemp` | Float? | — | — |
| `openAiHistory` | Int | 20 | — |
| `openAiPrompt` | String? | — | — |
| `similarityThreshold` | Float? | 0.25 | — |
| `chatProvider` | String? | — | — |
| `chatModel` | String? | — | — |
| `topN` | Int? | 4 | — |
| `chatMode` | String? | chat | — |
| `pfpFilename` | String? | — | — |
| `queryRefusalResponse` | String? | — | — |
| `vectorSearchMode` | String? | default | — |
| `webSearchEnabled` | Boolean? | false | — |
| `webSearchProvider` | String? | duckduckgo | — |
| `webSearchMaxResults` | Int? | 5 | — |
| `webSearchIncludeContent` | Boolean? | true | — |
| `googleApiKey` | String? | — | — |
| `googleSearchEngineId` | String? | — | — |
| `bingApiKey` | String? | — | — |
| `braveApiKey` | String? | — | — |
| `tavilyApiKey` | String? | — | — |
| `searxngUrl` | String? | — | — |
| `suggestedQuestionsEnabled` | Boolean? | false | — |
| `dynamicActionBarEnabled` | Boolean? | false | — |
| `ambientAgentProvider` | String? | default | — |
| `ambientAgentModel` | String? | — | — |
| `ambientAgentSystemPrompt` | String? | — | — |
| `email_short_id` | String? | — | — |
| `isSyncEnabled` | Boolean? | false | — |
| `syncInterval` | Int? | 60 | — |
| `directusAgentName` | String? | agent | — |
| `directusThreadId` | String? | — | — |
| `llmInstruction` | String? | — | — |
| `creator` | users? | — | — |
| `workspace_users` | workspace_users[] | — | — |
| `documents` | workspace_documents[] | — | — |
| `workspace_suggested_messages` | workspace_suggested_messages[] | — | — |
| `embed_configs` | embed_configs[] | — | — |
| `threads` | workspace_threads[] | — | — |
| `meeting_outputs` | meeting_outputs[] | — | — |
| `workspace_agent_invocations` | workspace_agent_invocations[] | — | — |
| `prompt_history` | prompt_history[] | — | — |
| `workspace_configs` | workspace_configs? | — | — |
| `webhook_data` | webhook_data[] | — | — |
| `workspace_parsed_files` | workspace_parsed_files[] | — | — |
| `knowledgeConfig` | String? | — | — |
| `type` | String? | default | — |
| `workspace_tasks` | workspace_tasks[] | — | — |
| `channel_plugins` | channel_plugins[] | — | — |
| `agentic_cli_workspace_overrides` | agentic_cli_workspace_overrides[] | — | — |

### AgenticCLI (`agentic_clis`)
A registered CLI tool (e.g. Claude, Gemini) that agents can invoke.

| Field | Type | Default | Notes |
|---|---|---|---|
| `cliId` | String? | — | — |
| `displayName` | String | — | — |
| `binary` | String | — | — |
| `authProbeCommand` | String? | — | — |
| `authInstructions` | String? | — | — |
| `versionCommand` | String? | — | — |
| `installDocsUrl` | String? | — | — |
| `skillHint` | String? | — | — |
| `enabled` | Boolean | true | — |
| `isCustom` | Boolean | false | — |
| `lastProbeStatus` | String | unknown | — |
| `lastProbeError` | String? | — | — |
| `lastProbeAt` | DateTime? | — | — |
| `workspace_overrides` | agentic_cli_workspace_overrides[] | — | — |

### agentic_cli_workspace_overrides (`agentic_cli_workspace_overrides`)
| Field | Type | Default | Notes |
|---|---|---|---|
| `agentic_cli_id` | Int | — | — |
| `workspace_id` | Int | — | — |
| `enabled` | Boolean | true | — |
| `agentic_cli` | agentic_clis | — | — |
| `workspace` | workspaces | — | — |

### WorkspaceConfig (`workspace_configs`)
Key-value config bag attached to a workspace (defaultAgent, etc.).

| Field | Type | Default | Notes |
|---|---|---|---|
| `workspace_id` | Int | — | — |
| `agentProvider` | String? | — | — |
| `agentModel` | String? | — | — |
| `agentSkills` | String? | — | JSON array of strings |
| `disabledAgentSkills` | String? | — | JSON array of strings |
| `customAgentSkills` | String? | — | JSON array of objects |
| `activeAgentFlows` | String? | — | JSON array of strings |
| `mcpServers` | String? | — | JSON array of strings |
| `defaultAgent` | String? | — | JSON object: {name, avatar, type, id} |
| `heartbeatConfig` | String? | — | JSON object: {enabled, every, activeHours: {start, end}} |
| `workspace` | workspaces | — | — |

### HeartbeatQueue (`heartbeat_queue`)
Queue of text items consumed by the ambient heartbeat agent.

| Field | Type | Default | Notes |
|---|---|---|---|
| `text` | String |  | — |
| `consumed` | Boolean | false | — |

### Thread (`workspace_threads`)
A conversation thread within a workspace. Can represent a meeting or a standalone chat.

| Field | Type | Default | Notes |
|---|---|---|---|
| `name` | String | — | — |
| `slug` | String | — | — |
| `workspace_id` | Int | — | — |
| `user_id` | Int? | — | — |
| `chatProvider` | String? | — | — |
| `chatModel` | String? | — | — |
| `meeting_source` | String? | manual | — |
| `meeting_status` | String? | draft | — |
| `scheduled_start_at` | DateTime? | — | — |
| `scheduled_end_at` | DateTime? | — | — |
| `calendar_event_uuid` | String? | — | — |
| `meeting_metadata` | String? | — | — |
| `meeting_settings` | String? | — | — |
| `last_evidence_at` | DateTime? | — | — |
| `watcher_state` | String? | idle | — |
| `recording_started_at` | DateTime? | — | — |
| `recording_completed_at` | DateTime? | — | — |
| `recording_status` | String? | — | — |
| `workspace` | workspaces | — | — |
| `user` | users? | — | — |
| `meeting_outputs` | meeting_outputs[] | — | — |
| `workspace_parsed_files` | workspace_parsed_files[] | — | — |
| `workspace_tasks` | workspace_tasks[] | — | — |

### workspace_chats (`workspace_chats`)
| Field | Type | Default | Notes |
|---|---|---|---|
| `workspaceId` | Int | — | — |
| `prompt` | String | — | — |
| `response` | String | — | — |
| `uuid` | String? | — | — |
| `include` | Boolean | true | — |
| `user_id` | Int? | — | — |
| `thread_id` | Int? | — | No relation to prevent whole table migration |
| `api_session_id` | String? | — | String identifier for only the dev API to partition chats in any mode. |
| `feedbackScore` | Boolean? | — | — |
| `users` | users? | — | — |

### AgentInvocation (`workspace_agent_invocations`)
A single agent task invocation with lifecycle state tracking.

| Field | Type | Default | Notes |
|---|---|---|---|
| `uuid` | String | — | — |
| `prompt` | String | — | Contains agent invocation to parse + option additional text for seed. |
| `closed` | Boolean | false | — |
| `user_id` | Int? | — | — |
| `thread_id` | Int? | — | No relation to prevent whole table migration |
| `workspace_id` | Int | — | — |
| `workspace_slug` | String? | — | — |
| `thread_slug` | String? | — | — |
| `user` | users? | — | — |
| `workspace` | workspaces | — | — |
| `workspace_agent_invocation_lifecycle` | workspace_agent_invocation_lifecycles? | — | — |

### workspace_agent_invocation_lifecycles (`workspace_agent_invocation_lifecycles`)
| Field | Type | Default | Notes |
|---|---|---|---|
| `invocation_id` | Int | — | — |
| `invocation_uuid` | String | — | — |
| `backend_id` | String? | — | — |
| `state` | String? | — | — |
| `resume_session_id` | String? | — | — |
| `initial_prompt_dispatched_at` | DateTime? | — | — |
| `turn_in_flight` | Boolean | false | — |
| `pending_permission_count` | Int | 0 | — |
| `last_error` | String? | — | — |
| `lifecycle_payload` | String? | — | — |
| `invocation` | workspace_agent_invocations | — | — |

### workspace_users (`workspace_users`)
| Field | Type | Default | Notes |
|---|---|---|---|
| `user_id` | Int | — | — |
| `workspace_id` | Int | — | — |
| `workspaces` | workspaces | — | — |
| `users` | users | — | — |

### cache_data (`cache_data`)
| Field | Type | Default | Notes |
|---|---|---|---|
| `name` | String | — | — |
| `data` | String | — | — |
| `belongsTo` | String? | — | — |
| `byId` | Int? | — | — |
| `expiresAt` | DateTime? | — | — |

### EmbedConfig (`embed_configs`)
Configuration for an embeddable chat widget hosted on an external site.

| Field | Type | Default | Notes |
|---|---|---|---|
| `uuid` | String | — | — |
| `enabled` | Boolean | false | — |
| `chat_mode` | String | chat | — |
| `allowlist_domains` | String? | — | — |
| `widget_settings` | String? | — | — |
| `max_chats_per_day` | Int? | — | — |
| `max_chats_per_session` | Int? | — | — |
| `message_limit` | Int? | 20 | — |
| `workspace_id` | Int | — | — |
| `usersId` | Int? | — | — |
| `workspace` | workspaces | — | — |
| `embed_chats` | embed_chats[] | — | — |
| `users` | users? | — | — |

### embed_chats (`embed_chats`)
| Field | Type | Default | Notes |
|---|---|---|---|
| `prompt` | String | — | — |
| `response` | String | — | — |
| `session_id` | String | — | — |
| `include` | Boolean | true | — |
| `connection_information` | String? | — | — |
| `embed_id` | Int | — | — |
| `usersId` | Int? | — | — |
| `embed_config` | embed_configs | — | — |
| `users` | users? | — | — |

### event_logs (`event_logs`)
| Field | Type | Default | Notes |
|---|---|---|---|
| `event` | String | — | — |
| `metadata` | String? | — | — |
| `userId` | Int? | — | — |
| `occurredAt` | DateTime | now( | — |

### system_logs (`system_logs`)
| Field | Type | Default | Notes |
|---|---|---|---|
| `level` | String | — | debug, info, warn, error, fatal |
| `source` | String | — | app, server, llm, vector-db, channel, embed, external |
| `message` | String | — | — |
| `context` | String? | — | JSON string for extra data |
| `timestamp` | DateTime | now( | — |

### slash_command_presets (`slash_command_presets`)
| Field | Type | Default | Notes |
|---|---|---|---|
| `command` | String | — | — |
| `prompt` | String | — | — |
| `description` | String | — | — |
| `uid` | Int | 0 | 0 is null user |
| `userId` | Int? | — | — |
| `is_purchased` | Boolean | false | — |
| `store_item_id` | String? | — | — |
| `user` | users? | — | — |

### system_prompt_presets (`system_prompt_presets`)
| Field | Type | Default | Notes |
|---|---|---|---|
| `name` | String | — | — |
| `prompt` | String | — | — |
| `description` | String? | — | — |
| `uid` | Int | 0 | 0 is null user |
| `userId` | Int? | — | — |
| `is_purchased` | Boolean | false | — |
| `store_item_id` | String? | — | — |
| `user` | users? | — | — |

### document_sync_executions (`document_sync_executions`)
| Field | Type | Default | Notes |
|---|---|---|---|
| `queueId` | Int | — | — |
| `status` | String | unknown | — |
| `result` | String? | — | — |
| `queue` | document_sync_queues | — | — |

### system_prompt_variables (`system_prompt_variables`)
| Field | Type | Default | Notes |
|---|---|---|---|
| `key` | String | — | — |
| `value` | String? | — | — |
| `description` | String? | — | — |
| `type` | String | system | system, user, dynamic |
| `userId` | Int? | — | — |
| `user` | users? | — | — |

### local_mcp_servers (`local_mcp_servers`)
| Field | Type | Default | Notes |
|---|---|---|---|
| `display_name` | String | — | — |
| `name` | String | — | — |
| `description` | String? | — | — |
| `server_type` | String | — | 'stdio' | 'http' | 'sse' (sse deprecated but kept for compatibility) |
| `config` | String | — | JSON - Runtime config (computed from store_config + user_config) |
| `store_config` | String? | — | JSON - Template config from Store with placeholders {{KEY}} |
| `user_config` | String? | — | JSON - User's placeholder values {"KEY": "value"} |
| `setup_schema` | String? | — | JSON Array - Schema for rich config UI (see config-schema-guide.md) |
| `enabled` | Boolean | true | Server-level enable/disable flag |
| `status` | String | stopped | 'stopped' | 'starting' | 'running' | 'error' | 'stopping' | 'disabled' |
| `enabled_tools` | String? | — | JSON Array - List of enabled tool names for granular control (["*"] means all tools enabled) |
| `icon_path` | String? | — | — |
| `tags` | String? | — | JSON Array - User-defined tags for organization |
| `metadata` | String? | — | JSON - Server metadata (is_default, category, default_key, etc.) |
| `is_configured` | Boolean | false | Tracks whether the server has user-provided configuration |

### agent_teams (`agent_teams`)
| Field | Type | Default | Notes |
|---|---|---|---|
| `name` | String | — | — |
| `description` | String? | — | — |
| `avatar` | String? | — | Path to avatar image file |
| `agents` | String | [] | JSON array of agent configurations |
| `connections` | String | [] | JSON array of connections between agents |
| `settings` | String | {} | JSON object of team settings |
| `a2aMetadata` | String | {} | A2A protocol metadata (Agent Card) |
| `tags` | String? | — | JSON array of tags |
| `lastModified` | DateTime | now( | — |

### desktop_mobile_devices (`desktop_mobile_devices`)
| Field | Type | Default | Notes |
|---|---|---|---|
| `deviceOs` | String | — | — |
| `deviceName` | String | — | — |
| `token` | String | — | — |
| `approved` | Boolean | false | — |
| `userId` | Int? | — | — |
| `user` | users? | — | — |

### agent_flow_schedule_runs (`agent_flow_schedule_runs`)
| Field | Type | Default | Notes |
|---|---|---|---|
| `flowUuid` | String | — | — |
| `mode` | String | interval | — |
| `userId` | Int? | — | — |
| `flowName` | String? | — | — |
| `intervalConfig` | String? | — | JSON string of interval configuration |
| `timezone` | String? | UTC | — |
| `active` | Boolean? | true | — |
| `lastRunAt` | DateTime? | — | — |
| `nextRunAt` | DateTime? | — | Calculated next run time |
| `source` | String? | — | null = manual, "api" = scheduler sync |
| `metadata` | String? | — | JSON string |

### AgentFlow (`agent_flows`)
An automated multi-step agent workflow.

| Field | Type | Default | Notes |
|---|---|---|---|
| `uuid` | String | — | Flow UUID, matches JSON filename |
| `name` | String | — | Flow display name |
| `description` | String? | — | Flow description |
| `active` | Boolean | true | Whether flow is enabled |
| `tags` | String? | — | JSON array of tags |
| `file_path` | String | — | Path to JSON file (relative to flowsDir) |
| `has_local_modifications` | Boolean | false | Whether user has modified a purchased flow |
| `creator` | String? | — | — |

### credentials (`credentials`)
| Field | Type | Default | Notes |
|---|---|---|---|
| `name` | String | — | — |
| `type` | String | — | Credential type identifier, e.g. http_header, query_auth, basic_auth, env_var |
| `data` | String | — | Encrypted credential data stored as a string |
| `metadata` | String? | — | Optional metadata payload as a JSON string |
| `deletedAt` | DateTime? | — | — |

### acp_auth_profiles (`acp_auth_profiles`)
| Field | Type | Default | Notes |
|---|---|---|---|
| `profileId` | String | — | — |
| `userId` | Int? | — | — |
| `providerId` | String | — | — |
| `type` | String | api_key | api_key, oauth, token |
| `credential` | String | — | Encrypted JSON via EncryptionManager |
| `label` | String | default | — |

### CalendarEvent (`calendar_events`)
A calendar event linked to a workspace thread (meeting integration).

| Field | Type | Default | Notes |
|---|---|---|---|
| `uuid` | String | uuid( | — |
| `title` | String | — | — |
| `description` | String? | — | — |
| `startDate` | DateTime | — | — |
| `endDate` | DateTime? | — | — |
| `allDay` | Boolean | false | — |
| `color` | String? | #3b82f6 | — |
| `repeat` | String? | — | JSON: {type, interval, endDate, count, weekdays} |
| `reminders` | String? | — | JSON array: [{type: 'notification', minutes: 15}] |
| `metadata` | String? | — | JSON for extensibility: location, participants, conferencing, etc. |
| `externalProvider` | String? | — | — |
| `externalAccountId` | String? | — | — |
| `externalCalendarId` | String? | — | — |
| `externalEventId` | String? | — | — |
| `externalEventUrl` | String? | — | — |
| `externalReadOnly` | Boolean | false | — |
| `userId` | Int? | — | — |

### calendar_provider_credentials (`calendar_provider_credentials`)
| Field | Type | Default | Notes |
|---|---|---|---|
| `provider` | String | — | e.g. "google", "outlook" |
| `clientId` | String | — | Encrypted via EncryptionManager |
| `clientSecret` | String | — | Encrypted via EncryptionManager |

### user_calendar_tokens (`user_calendar_tokens`)
| Field | Type | Default | Notes |
|---|---|---|---|
| `userId` | Int | — | — |
| `provider` | String | — | e.g. "google", "outlook" |
| `accountId` | String | — | Provider's stable account identifier (Google: sub). Allows multiple accounts per provider. |
| `accountEmail` | String? | — | Human-readable email label shown in UI |
| `accessToken` | String | — | Encrypted via EncryptionManager |
| `refreshToken` | String? | — | Encrypted via EncryptionManager (nullable: not all flows return a refresh token) |
| `expiresAt` | DateTime? | — | — |
| `scope` | String? | — | OAuth scopes granted |
| `calendarSelection` | String? | — | JSON: { selectedCalendarIds: string[] } |
| `lastSyncAt` | DateTime? | — | — |

### calendar_operator_audits (`calendar_operator_audits`)
| Field | Type | Default | Notes |
|---|---|---|---|
| `uuid` | String | uuid( | — |
| `userId` | Int? | — | — |
| `workspaceId` | Int? | — | — |
| `threadId` | Int? | — | — |
| `invocationUuid` | String? | — | — |
| `permissionRequestId` | String? | — | — |
| `source` | String | acp_live | acp_live | acp_api |
| `action` | String | — | — |
| `status` | String | requested | requested | approved | rejected | timed_out | executed | failed |
| `target` | String? | — | — |
| `reason` | String? | — | — |
| `provider` | String? | — | — |
| `accountId` | String? | — | — |
| `calendarId` | String? | — | — |
| `eventUuid` | String? | — | — |
| `title` | String? | — | — |
| `startDate` | String? | — | — |
| `endDate` | String? | — | — |
| `allDay` | Boolean | false | — |
| `sendUpdates` | String? | — | — |
| `responseStatus` | String? | — | — |
| `createConference` | Boolean | false | — |
| `selectedOptionId` | String? | — | — |
| `approvedAt` | DateTime? | — | — |
| `executedAt` | DateTime? | — | — |
| `failedAt` | DateTime? | — | — |
| `metadata` | String? | — | JSON |

### meeting_outputs (`meeting_outputs`)
| Field | Type | Default | Notes |
|---|---|---|---|
| `uuid` | String | uuid( | — |
| `workspace_id` | Int | — | — |
| `thread_id` | Int | — | — |
| `source_output_id` | Int? | — | — |
| `output_type` | String | — | — |
| `title` | String | — | — |
| `content` | String | — | — |
| `status` | String | draft | — |
| `generation_mode` | String | manual | — |
| `template_key` | String? | — | — |
| `evidence_snapshot` | String? | — | — |
| `settings_snapshot` | String? | — | — |
| `workspace` | workspaces | — | — |
| `thread` | workspace_threads | — | — |

### LocalApp (`local_apps`)
A registered SDK application with scoped permissions (x-app-id auth).

| Field | Type | Default | Notes |
|---|---|---|---|
| `display_name` | String | — | — |
| `name` | String | — | — |
| `description` | String? | — | — |
| `app_type` | String | — | 'python' | 'node' | 'npx' | 'uvx' | 'custom' |
| `config` | String | — | JSON - Runtime config (computed from store_config + user_config) |
| `store_config` | String? | — | JSON - Template config from Store with placeholders {{KEY}} |
| `user_config` | String? | — | JSON - User's placeholder values {"KEY": "value"} |
| `setup_schema` | String? | — | JSON Array - Schema for rich config UI (see config-schema-guide.md) |
| `enabled` | Boolean | true | — |
| `status` | String | stopped | 'stopped' | 'starting' | 'running' | 'error' | 'stopping' | 'disabled' |
| `icon_path` | String? | — | — |
| `tags` | String? | — | JSON Array |
| `metadata` | String? | — | JSON - App metadata |
| `is_configured` | Boolean | true | Tracks whether the app has user-provided configuration |

### external_tasks (`external_tasks`)
| Field | Type | Default | Notes |
|---|---|---|---|
| `uuid` | String | uuid( | — |
| `sourceApp` | String | — | "uuid:xxx" |
| `tableName` | String | — | "activities" |
| `actionType` | String | — | "INSERT" | "UPDATE" | "DELETE" |
| `title` | String | — | "[app] type: ACTION uuid:xxx" |
| `rawData` | String | — | JSON - Full Supabase payload |
| `oldData` | String? | — | JSON - For UPDATE events |
| `status` | String | pending | pending | claimed | processing | completed | failed | rejected |
| `webhookUrl` | String? | — | Local App webhook URL for forwarding |
| `lockUrl` | String? | — | Local App lock API URL for claiming |
| `claimedByEmail` | String? | — | Email of user who claimed this task |
| `error` | String? | — | Error message if failed |
| `attemptedBy` | String? | — | JSON Array - Machine IDs that attempted and failed |
| `retryCount` | Int | 0 | Number of retry attempts |
| `runs` | external_task_runs[] | — | — |

### external_task_runs (`external_task_runs`)
| Field | Type | Default | Notes |
|---|---|---|---|
| `taskUuid` | String | — | — |
| `agentName` | String | — | — |
| `workspaceSlug` | String | — | — |
| `threadSlug` | String? | — | — |
| `prompt` | String? | — | The prompt used for this run |
| `status` | String | pending | pending | running | completed | failed |
| `error` | String? | — | Error message if failed |
| `startedAt` | DateTime? | — | — |
| `completedAt` | DateTime? | — | — |
| `task` | external_tasks | — | — |

### marketplace_items (`marketplace_items`)
| Field | Type | Default | Notes |
|---|---|---|---|
| `entity_type` | String | — | 'local_app' | 'local_mcp_server' | 'mcp_server' | 'agent_flow' | 'slash_command' | 'agent' | 'system_prompt' |
| `entity_id` | String | — | Polymorphic FK to respective table |
| `store_item_id` | String? | — | ID on marketplace store side (after publish) |
| `status` | String | published | draft | published - for saving to store |
| `marketplace_status` | String | available | available | unavailable | maintenance - for visibility |
| `publish_metadata` | String? | — | JSON - price, full_description, is_featured, etc. |
| `store_updated_at` | DateTime? | — | Store's date_updated for sync detection |
| `cover_image_path` | String? | — | Path to cover image for marketplace listing |
| `is_purchased` | Boolean | false | Whether this item was purchased from the store |

### AgentSkill (`agent_skills`)
A skill (tool-set) available to agents. Can come from a git repo, zip file, or plugin.

| Field | Type | Default | Notes |
|---|---|---|---|
| `name` | String | — | — |
| `display_name` | String | — | — |
| `description` | String? | — | — |
| `skill_id` | String? | — | Store's ID, used when synced from marketplace |
| `repository_url` | String? | — | — |
| `ref` | String? | — | Git ref (branch/tag) |
| `skill_path` | String? | — | Path within repository |
| `zip_file` | String? | — | Path to local zip file |
| `type` | String | repo | 'repo' | 'zip' |
| `scope` | String | uploaded | 'global' | 'workspace' | 'local-app' | 'uploaded' | 'plugin' |
| `status` | String | draft | 'draft' | 'published' |
| `pending_publish` | Boolean | true | Tracks if code/ZIP changed and needs new version publish |
| `plugin_id` | String? | — | FK to plugins.id — set when skill is contributed by a plugin's manifest |
| `plugin` | plugins? | — | — |

### local_app_vector_configs (`local_app_vector_configs`)
| Field | Type | Default | Notes |
|---|---|---|---|
| `app_id` | String | — | — |
| `provider` | String | — | — |
| `config` | String | — | — |

### WorkspaceTask (`workspace_tasks`)
A discrete task created within a workspace.

| Field | Type | Default | Notes |
|---|---|---|---|
| `uuid` | String | uuid( | — |
| `workspace_id` | Int | — | — |
| `thread_id` | Int? | — | — |
| `title` | String | — | — |
| `description` | String? | — | — |
| `status` | String | submitted | submitted, working, input-required, completed, failed, canceled |
| `agent_id` | String? | — | — |
| `source` | String? | web | web, api, schedule, etc |
| `priority` | String? | normal | — |
| `due_at` | DateTime? | — | — |
| `result` | String? | — | JSON string of task result |
| `metadata` | String? | — | JSON string of additional metadata |
| `created_by` | Int? | — | — |
| `created_at` | DateTime | now( | — |
| `updated_at` | DateTime | — | — |
| `workspace` | workspaces | — | — |
| `user` | users? | — | — |
| `thread` | workspace_threads? | — | — |

### ChannelPlugin (`channel_plugins`)
A messaging channel integration (e.g. Slack, Teams) linked to a workspace.

| Field | Type | Default | Notes |
|---|---|---|---|
| `uuid` | String | uuid( | — |
| `workspace_id` | Int | — | — |
| `plugin_type` | String | — | "telegram" | "slack" | "discord" |
| `name` | String? | — | — |
| `enabled` | Boolean | false | — |
| `config` | String | — | JSON - encrypted credentials (bot token) |
| `settings` | String? | — | JSON - plugin-specific settings |
| `status` | String | stopped | stopped|starting|running|error |
| `error_message` | String? | — | — |
| `created_by` | Int? | — | — |
| `workspace` | workspaces | — | — |
| `channel_users` | channel_users[] | — | — |
| `channel_sessions` | channel_sessions[] | — | — |
| `channel_pairing_codes` | channel_pairing_codes[] | — | — |

### channel_users (`channel_users`)
| Field | Type | Default | Notes |
|---|---|---|---|
| `plugin_id` | Int | — | — |
| `platform_user_id` | String | — | — |
| `platform_username` | String? | — | — |
| `authorized` | Boolean | true | — |
| `metadata` | String? | — | JSON |
| `plugin` | channel_plugins | — | — |
| `channel_sessions` | channel_sessions[] | — | — |

### channel_sessions (`channel_sessions`)
| Field | Type | Default | Notes |
|---|---|---|---|
| `plugin_id` | Int | — | — |
| `channel_user_id` | Int | — | — |
| `platform_chat_id` | String | — | — |
| `thread_id` | Int? | — | — |
| `active` | Boolean | true | — |
| `metadata` | String? | — | JSON |
| `plugin` | channel_plugins | — | — |
| `channel_user` | channel_users | — | — |

### channel_pairing_codes (`channel_pairing_codes`)
| Field | Type | Default | Notes |
|---|---|---|---|
| `plugin_id` | Int | — | — |
| `code` | String | — | — |
| `platform_user_id` | String? | — | — |
| `platform_username` | String? | — | — |
| `status` | String | pending | pending|approved|rejected|expired |
| `expiresAt` | DateTime | — | — |
| `plugin` | channel_plugins | — | — |

### WorkspaceMemory (`workspace_memories`)
A long-term memory entry stored for a workspace.

| Field | Type | Default | Notes |
|---|---|---|---|
| `uuid` | String | uuid( | — |
| `workspace_id` | Int | — | — |
| `user_id` | Int? | — | — |
| `category` | String | fact | fact, preference, instruction, entity |
| `content` | String | — | — |
| `content_hash` | String? | — | — |
| `vector_id` | String? | — | — |
| `source_chat_id` | Int? | — | — |
| `source_thread_id` | Int? | — | — |
| `importance` | Int | 5 | 1-10 |
| `access_count` | Int | 0 | — |
| `active` | Boolean | true | — |
| `metadata` | String? | — | — |
| `lastAccessedAt` | DateTime | now( | — |
| `source_file` | String? | — | relative path: "MEMORY.md" or "2026-03-09.md" |
| `file_hash` | String? | — | SHA256 of source file at sync time |
| `chunk_index` | Int? | — | position within file (for multi-memory files) |

### Plugin (`plugins`)
An installable plugin that extends RealtimeX with new providers, skills, or channels.

| Field | Type | Default | Notes |
|---|---|---|---|
| `name` | String | — | Machine-readable slug: "notion-integration" |
| `display_name` | String | — | "Notion Integration" |
| `description` | String? | — | — |
| `version` | String | — | Semver: "1.0.0" |
| `author` | String? | — | — |
| `license` | String? | — | — |
| `install_source` | String | local | 'local' | 'marketplace' | 'zip' | 'git' | 'builtin' |
| `install_ref` | String? | — | Source URL, npm name, marketplace ID, etc. |
| `manifest` | String | — | JSON - Full realtimex.plugin.json contents |
| `capabilities` | String | [] | JSON Array - ["tools","hooks"] (denormalized for queries) |
| `setup_schema` | String? | — | JSON Array - Schema for rich config UI |
| `store_config` | String? | — | JSON - Template config with {{PLACEHOLDER}} values |
| `user_config` | String? | — | JSON - User's placeholder values {"KEY": "value"} |
| `enabled` | Boolean | true | Global enable/disable |
| `status` | String | installed | 'installed' | 'active' | 'error' | 'disabled' |
| `error_message` | String? | — | — |
| `storage_path` | String? | — | Relative path within server/storage/plugins/ |
| `icon_path` | String? | — | — |
| `tags` | String? | — | JSON Array |
| `metadata` | String? | — | JSON - Extra data (homepage, repository, etc.) |
| `skills` | agent_skills[] | — | Skills contributed by this plugin's manifest (CASCADE on plugin delete) |

### workspace_memory_configs (`workspace_memory_configs`)
| Field | Type | Default | Notes |
|---|---|---|---|
| `workspace_id` | Int | — | — |
| `memory_enabled` | Boolean | true | — |
| `auto_extract` | Boolean | true | — |
| `max_memories` | Int | 200 | — |
| `injection_token_limit` | Int | 800 | — |
| `similarity_dedup_threshold` | Float | 0.9 | — |
| `temporal_decay_halflife` | Int | 30 | — |
| `hybrid_search_enabled` | Boolean | true | — |
| `vector_weight` | Float | 0.7 | — |
| `keyword_weight` | Float | 0.3 | — |
| `mmr_enabled` | Boolean | false | — |
| `mmr_lambda` | Float | 0.7 | — |
| `temporal_decay_enabled` | Boolean | false | — |
| `chunking_enabled` | Boolean | true | — |
| `extraction_mode` | String | per_turn | — |
| `search_backend` | String | builtin | — |
| `qmd_search_mode` | String | search | — |
| `qmd_max_results` | Int | 6 | — |
| `qmd_timeout_ms` | Int | 4000 | — |
| `qmd_candidate_multiplier` | Int | 3 | — |
| `qmd_min_score` | Float | 0.0 | — |
| `qmd_intent` | String |  | — |
| `qmd_candidate_limit` | Int | 40 | — |
| `qmd_skip_rerank` | Boolean | false | — |
