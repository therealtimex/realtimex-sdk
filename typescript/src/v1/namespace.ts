/**
 * V1ApiNamespace - Container for all RealtimeX Developer API (v1) modules.
 *
 * Usage:
 *   const sdk = new RealtimeXSDK({ realtimex: { apiKey: 'sk-...' } });
 *   await sdk.v1?.workspace.listWorkspaces();
 *   await sdk.v1?.thread.createThread('workspace-slug');
 *
 * Regenerate modules: node scripts/generate-v1-sdk.mjs --force
 */

import { DeveloperApiClient } from './client';

// [GENERATED-IMPORTS-START]
import { V1WorkspaceModule } from './modules/v1Workspace';
import { V1ThreadModule } from './modules/v1Thread';
// [GENERATED-IMPORTS-END]

export class V1ApiNamespace {
    /** @internal Shared HTTP client used by all v1 modules */
    readonly _client: DeveloperApiClient;

    // [GENERATED-PROPS-START]
    public workspace: V1WorkspaceModule;
    public thread: V1ThreadModule;
// [GENERATED-PROPS-END]

    constructor(baseUrl: string, apiKey: string, appId?: string) {
        this._client = new DeveloperApiClient(baseUrl, apiKey, appId);

        // [GENERATED-INIT-START]
        this.workspace = new V1WorkspaceModule(this._client);
        this.thread = new V1ThreadModule(this._client);
// [GENERATED-INIT-END]
    }
}
