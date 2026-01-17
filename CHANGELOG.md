# Changelog

All notable changes to the RealtimeX SDK will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.8] - 2026-01-17

### Added
- **x-app-id header**: All API module requests now include `x-app-id` header for authentication
- Required for server-side permission enforcement

### Changed
- `ApiModule` constructor now requires `appId` parameter (TypeScript & Python)
- All API calls (`getAgents`, `getWorkspaces`, `getThreads`, `getTask`) now send authentication header

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
