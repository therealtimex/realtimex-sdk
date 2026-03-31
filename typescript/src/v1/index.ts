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
