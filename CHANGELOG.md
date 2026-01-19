# Changelog

All notable changes to the RealtimeX SDK will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
