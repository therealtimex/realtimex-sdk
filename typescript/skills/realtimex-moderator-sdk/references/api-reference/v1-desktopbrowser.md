# sdk.v1.desktopBrowser — v1 Desktop Browser

> Auto-generated from `@realtimex/sdk` source · v**1.7.22** · 2026-05-29

## `V1DesktopBrowserModule`

### Methods

```ts
// List RealTimeX Browser sessions available in the Electron desktop app.
async listSessions(): Promise<unknown>

// Create a named RealTimeX Browser session in the Electron desktop app.
async createSession(body?: Record<string, unknown>): Promise<unknown>

// Get a specific RealTimeX Browser session by session name.
async getSession(sessionName: string): Promise<unknown>

// Delete a named RealTimeX Browser session from the Electron desktop app.
async deleteSession(sessionName: string): Promise<unknown>

// Create a RealTimeX Browser tab, optionally launching the browser session if needed.
async createTab(body?: Record<string, unknown>): Promise<unknown>

// Get a RealTimeX Browser tab snapshot by tab reference.
async getTab(tabRef: string): Promise<unknown>

// Close an existing RealTimeX Browser tab.
async deleteTab(tabRef: string): Promise<unknown>

// Evaluate JavaScript in a specific RealTimeX Browser tab.
async evaluateTab(tabRef: string, body?: Record<string, unknown>): Promise<unknown>

// Focus an existing RealTimeX Browser tab.
async focusTab(tabRef: string, body?: Record<string, unknown>): Promise<unknown>

// Navigate an existing RealTimeX Browser tab to a new URL.
async navigateTab(tabRef: string, body?: Record<string, unknown>): Promise<unknown>
```
