# sdk.v1.desktopEmbed — v1 Desktop Embed

> Auto-generated from `@realtimex/sdk` source · v**1.7.22** · 2026-05-29

## `V1DesktopEmbedModule`

### Methods

```ts
// @see GET /v1/desktop-public-embed/status
async getStatus(): Promise<unknown>

// @see POST /v1/desktop-public-embed/exposures
async createExposure(): Promise<unknown>

// @see POST /v1/desktop-public-embed/exposures/{exposureId}/heartbeat
async exposuresHeartbeat(exposureId: string): Promise<unknown>

// @see GET /v1/desktop-public-embed/exposures/{exposureId}
async getExposure(exposureId: string): Promise<unknown>

// @see DELETE /v1/desktop-public-embed/exposures/{exposureId}
async deleteExposure(exposureId: string): Promise<unknown>
```
