# sdk.v1.desktopRuntimeSessions — v1 Desktop Runtime Sessions

> Auto-generated from `@realtimex/sdk` source · v**1.7.18** · 2026-05-18

## `V1DesktopRuntimeSessionsModule`

### Methods

```ts
// Open the shared terminal launcher in the Electron desktop app.
async openLauncher(body?: Record<string, unknown>): Promise<unknown>

// Launch a local PTY-backed shell terminal in the Electron desktop app.
async launchTerminalShell(body?: Record<string, unknown>): Promise<unknown>

// Launch a local PTY-backed CLI agent terminal in the Electron desktop app.
async launchTerminalCliAgent(body?: Record<string, unknown>): Promise<unknown>

// List desktop PTY-backed runtime sessions currently known to the Electron app.
async listRuntimeSessions(): Promise<unknown>

// Fetch one desktop PTY-backed runtime session by runtime session ID or PTY session ID.
async getRuntimeSession(sessionId: string): Promise<unknown>

// Close an existing desktop runtime session.
async deleteRuntimeSession(sessionId: string): Promise<unknown>

// Write input to an existing desktop runtime session. Use `message` to submit a CLI turn or `input` for raw PTY data.
async write(sessionId: string, body?: Record<string, unknown>): Promise<unknown>

// Approve or deny a pending desktop runtime session action.
async permission(sessionId: string, body?: Record<string, unknown>): Promise<unknown>
```
