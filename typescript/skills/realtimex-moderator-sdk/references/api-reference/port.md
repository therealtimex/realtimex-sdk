# sdk.port — Port Management

> Auto-generated from `@realtimex/sdk` source · v**1.7.18** · 2026-05-18

## `PortModule`

### Methods

```ts
// Get suggested port from environment (RTX_PORT) or default
getSuggestedPort(): number

// Check if a port is available on a specific host
async isPortAvailable(port: number): Promise<boolean>

// Find an available port starting from the suggested port
async findAvailablePort(startPort?: number, maxAttempts: number = 100): Promise<number>

// Get a ready-to-use port
async getPort(): Promise<number>
```
