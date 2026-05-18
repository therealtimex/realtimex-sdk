# sdk.contract — Local App Contract

> Auto-generated from `@realtimex/sdk` source · v**1.7.18** · 2026-05-18

## `ContractModule`

### Methods

```ts
async getLocalAppV1(forceRefresh = false): Promise<LocalAppContractDefinition>

async listCapabilities(forceRefresh = false): Promise<ContractCapability[]>

async searchCapabilities(query: string): Promise<ContractCapability[]>

async describeCapability(capabilityId: string): Promise<ContractCapability>

async search(query: string): Promise<ContractCapability[]>

async describe(capabilityId: string): Promise<ContractCapability>

async invoke(payload: ContractInvokePayload): Promise<TriggerAgentResponse>

getCachedCatalogHash(): string | null

clearCache(): void
```
