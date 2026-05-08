/**
 * RealtimeX SDK - Developer API (v1) Entry Point
 *
 * Import from '@realtimex/sdk/v1' for tree-shaking (does not include SDK core).
 * Or access via sdk.v1 on an initialized RealtimeXSDK instance.
 */

export { V1ApiNamespace } from './namespace';
export { DeveloperApiClient } from './client';
export {
    DeveloperApiError,
    AuthenticationError,
    NotFoundError,
    ValidationError,
    ServerError,
} from './errors';

// Generated module exports are appended here by generate-v1-sdk.mjs

// [GENERATED-MODULE-EXPORTS-START]
export { V1AuthModule } from './modules/v1Auth';
export { V1AdminModule } from './modules/v1Admin';
export { V1DocumentModule } from './modules/v1Document';
export { V1WorkspaceModule } from './modules/v1Workspace';
export { V1SystemModule } from './modules/v1System';
export { V1ThreadModule } from './modules/v1Thread';
export { V1UsersModule } from './modules/v1Users';
export { V1OpenAIModule } from './modules/v1OpenAI';
export { V1EmbedModule } from './modules/v1Embed';
export { V1DesktopRuntimeSessionsModule } from './modules/v1DesktopRuntimeSessions';
export { V1DesktopBrowserModule } from './modules/v1DesktopBrowser';
// [GENERATED-MODULE-EXPORTS-END]

// Manual override exports — streaming helpers and typed upload utilities
export type { WorkspaceStreamChunk } from './overrides/v1WorkspaceStreaming';
export { streamWorkspaceChat } from './overrides/v1WorkspaceStreaming';
export type { ThreadStreamChunk } from './overrides/v1ThreadStreaming';
export { streamThreadChat } from './overrides/v1ThreadStreaming';
export type { UploadedDocument, UploadFileOptions } from './overrides/v1DocumentUpload';
export { uploadFile, uploadFileToFolder } from './overrides/v1DocumentUpload';
