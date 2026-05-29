# sdk.v1.auth — v1 Auth

> Auto-generated from `@realtimex/sdk` source · v**1.7.22** · 2026-05-29

## `V1AuthModule`

### Methods

```ts
// Verify the attached Authentication header contains a valid API token.
async getAuth(): Promise<unknown>

// Relay external browser auth callbacks back to the local Electron renderer. Localhost only; keyed by OAuth state.
async externalCallback(): Promise<unknown>

// Poll for a relayed external browser auth callback by OAuth state. Localhost only.
async getExternalCallback(state: string): Promise<unknown>
```
