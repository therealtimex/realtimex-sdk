# Changelog

All notable changes to the RealtimeX SDK will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.5-rc.1] - 2026-03-04

### Added
- **Local App Contract v1 module (TypeScript + Python)**: discover canonical contract schema via `getLocalAppV1()` / `get_local_app_v1()` and shared helpers for event normalization, attempt IDs, idempotency keys, and callback signing.
- **Contract compatibility verifier**: new script `scripts/verify-contract-compat.mjs` to compare SDK contract surfaces with Main App `/contracts/local-app/v1`.

### Changed
- **Task lifecycle callbacks upgraded to canonical events**: task APIs now emit `task.claimed|started|progress|completed|failed|canceled`, always include `event_id`, and support canonical+legacy callback payloads for backward compatibility.
- **Optional callback signing controls**: `callbackSecret` / `signCallbacksByDefault` config in both SDKs for signed callback rollouts.
- **SDK exports parity**: MCP module and new Contract module are both exported from TypeScript and Python SDK clients.

### Notes
- This is a release candidate intended for Local App contract pilot validation before stable `1.3.5`.

## [1.3.3] - 2026-02-28

### Fixed
- **TypeScript multimodal chat typing**: `ChatMessage.content` now accepts both plain text and multimodal content blocks (text/image/file), preventing compile-time failures when sending file/image inputs.
- **Python multimodal chat typing**: `ChatMessage.content` now supports multimodal content blocks in type hints, with stronger `TypedDict` models for common block shapes and a fallback for custom provider blocks.
- **Cross-SDK parity**: Added/updated TypeScript and Python README examples for multimodal chat payloads and exported new content block types for SDK consumers.
- **Version consistency**: Synchronized Python package runtime version export with package metadata for this release.
 
## [1.1.4] - 2026-01-26
 
### Added
- **App Data Directory Discovery**: New `sdk.getAppDataDir()` (TS) and `sdk.get_app_data_dir()` (Python) methods to retrieve the absolute path to the app's persistent storage.
- **Custom Vector Storage support**: 
  - `sdk.llm.vectors.listProviders()`: Discover supported vector database engines and their configuration requirements.
  - `sdk.llm.vectors.registerConfig()`: Register a custom production-grade vector database (PGVector, Chroma, AstraDB, etc.).
  - `sdk.llm.vectors.getConfig()`: Programmatically retrieve the current active storage configuration.
- **Automatic Connection Validation**: The system now verifies connectivity before saving custom vector database configurations.
- **Improved Dev Isolation**: In Development Mode, configurations and storage are now isolated by API Key to prevent data collision when multiple apps share the same local server.
 
### Changed
- **PGVector Isolated Tables**: Each app now uses an isolated table name within the configured PostgreSQL database.
- **LanceDB Auto-Management**: Default LanceDB storage is now isolated per App ID at `./storage/lancedb-custom/{appId}`.
- **Documentation**: New sections added for "App Data Directory" and "Custom Vector Storage" in both Developer Guide and API Reference.
 
### Fixed
- Fixed identity collision in Development Mode by using masked API Key for state derivation.
- Standardized vector provider initialization to support the Factory pattern for better per-app isolation.

## [1.1.0] - 2026-01-22

### Added
- **LLM Proxy Module** (`sdk.llm`): Access RealtimeX's LLM capabilities without managing API keys.
  - `chat()` / `chatStream()`: Synchronous and streaming chat completion.
  - `embed()`: Generate text embeddings using configured embedding engine.
  - `providers()`: List available LLM and embedding models.
  - `search()`: High-level RAG search (embed query + vector search combined).

- **Vector Store Module** (`sdk.llm.vectors`): Managed vector storage for RAG applications.
  - `upsert()`: Store vectors with metadata (`workspaceId`, `documentId`).
  - `query()`: Semantic similarity search with optional `documentId` filtering.
  - `delete()`: Delete vectors by workspace (supports `deleteAll: true`).

- **New Permissions**: `llm.chat`, `llm.embed`, `llm.providers`, `vectors.read`, `vectors.write`.

- **Example Apps Updated**: Both Node.js and Python demo apps now include:
  - RAG testing UI with 3 steps: Ingest Data → Search Test → Raw Embedding.
  - Workspace ID support for physical data isolation.
  - Document ID support for logical filtering within workspaces.

### Changed
- SDK architecture now supports LLM and Vector Store operations alongside existing API/Webhook modules.
- Documentation updated with new endpoints and usage examples.

### Technical Notes
- **Workspace ID**: Creates separate namespaces in vector database (physical isolation).
- **Document ID**: Stored as metadata, filtered at endpoint level (post-filter) for provider compatibility.

## [1.0.9] - 2026-01-19

### Added
- **Manifest-based Permission System**: Declare required permissions in the SDK constructor.
- **Auto-registration**: SDK automatically registers with RealtimeX Hub on initialization to prompt for permissions upfront.
- **Runtime Permission Retries**: All modules (`Api`, `Activities`, `Webhook`) now handle `403 PERMISSION_REQUIRED` by triggering a native permission dialog and automatically retrying the request.
- **Remote SDK Logging**: Added support for sending SDK logs to the RealtimeX server for easier debugging in production environments.

### Fixed
- Fixed missing `/api` prefix in permission request endpoints for `ActivitiesModule` and `WebhookModule`.
- Standardized error handling across TypeScript and Python SDKs.

### Changed
- `ApiModule` constructor now accepts optional `appName` for better identify in permission dialogs.
- Improved permission check logging on server and SDK sides.
- Updated documentation and READMEs to reflect the new permission flow.

## [1.0.7] - 2026-01-16

### Added
- Port auto-detection feature with `RTX_PORT` environment variable support
- `PortModule` for port management

### Changed
- SDK modules now read configuration from environment variables

## [1.0.6] - 2026-01-15

### Added
- Activities module for reading/writing activities data
- Task module for creating and tracking tasks

## [1.0.5] - 2026-01-14

### Initial Release
- Core SDK structure with modular architecture
- Webhook module for triggering agents
- API module for accessing RealtimeX APIs
- TypeScript and Python implementations
