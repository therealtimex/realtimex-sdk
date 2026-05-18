# sdk.v1.credentials — v1 Credentials

> Auto-generated from `@realtimex/sdk` source · v**1.7.19** · 2026-05-18

## `V1CredentialsModule`

### Methods

```ts
// @see POST /v1/credentials
async createCredential(): Promise<unknown>

// @see GET /v1/credentials
async listCredentials(): Promise<unknown>

// @see GET /v1/credentials/{id}
async getCredential(id: string): Promise<unknown>

// @see PUT /v1/credentials/{id}
async replaceCredential(id: string): Promise<unknown>

// @see DELETE /v1/credentials/{id}
async deleteCredential(id: string): Promise<unknown>

// @see POST /v1/credentials/{id}/restore
async restore(id: string): Promise<unknown>
```
