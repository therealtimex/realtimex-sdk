# Core — RealtimeXSDK

> Auto-generated from `@realtimex/sdk` source · v**1.7.18** · 2026-05-18

## `RealtimeXSDK`

### Public Properties

- `activities: ActivitiesModule`
- `webhook: WebhookModule`
- `api: ApiModule`
- `task: TaskModule`
- `port: PortModule`
- `llm: LLMModule`
- `tts: TTSModule`
- `stt: STTModule`
- `agent: AgentModule`
- `acpAgent: AcpAgentModule`
- `mcp: MCPModule`
- `contract: ContractModule`
- `contractRuntime: ContractRuntime`
- `database: DatabaseModule`
- `auth: AuthModule`
- `credentials: CredentialsModule`
- `v1: V1ApiNamespace | undefined`
- `desktopRuntimeSessions: V1DesktopRuntimeSessionsModule | undefined`
- `desktopBrowser: V1DesktopBrowserModule | undefined`

### Methods

```ts
// Developer API (v1) — requires apiKey to be set in config.
async register(permissions?: string[]): void

// Get environment variable (works in Node.js and browser)
async ping(): Promise<

// Get the absolute path to the data directory for this app.
async getAppDataDir(): Promise<string>
```
