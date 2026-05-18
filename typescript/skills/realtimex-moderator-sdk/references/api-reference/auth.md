# sdk.auth — Auth Token

> Auto-generated from `@realtimex/sdk` source · v**1.7.18** · 2026-05-18

## `AuthModule`

### Methods

```ts
// Push a Supabase access token to the Main App.
async syncSupabaseToken(token: string): Promise<SyncTokenResponse>

// Retrieve the current Keycloak access token from Main App.
async getAccessToken(): Promise<AuthTokenResponse | null>
```

## `AuthTokenResponse`

> Auth Module - Authentication helpers for RealtimeX SDK

```ts
token: string
hasToken: boolean
syncedAt: string | null
source: string | null
```

## `SyncTokenResponse`

```ts
success: boolean
message: string
hasToken: boolean
syncedAt: string | null
source: string | null
```
