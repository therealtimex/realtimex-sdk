# sdk.v1.channels — v1 Channels

> Auto-generated from `@realtimex/sdk` source · v**1.7.22** · 2026-05-29

## `V1ChannelsModule`

### Methods

```ts
// List configured channel plugins without exposing encrypted plugin configuration.
async listPlugins(): Promise<unknown>

// Create a channel plugin. The request may include provider credentials in config, but credentials are never returned.
async createPlugin(body?: Record<string, unknown>): Promise<unknown>

// Get editable non-secret channel plugin configuration.
async getConfig(id: string): Promise<unknown>

// Update a channel plugin. Config values are encrypted before storage.
async updatePlugin(id: string, body?: Record<string, unknown>): Promise<unknown>

// Delete a channel plugin and stop any running plugin instance.
async deletePlugin(id: string): Promise<unknown>

// Enable and start a channel plugin.
async pluginsStart(id: string): Promise<unknown>

// Disable and stop a channel plugin.
async pluginsStop(id: string): Promise<unknown>

// Test channel provider credentials without saving a plugin.
async pluginsTest(body?: Record<string, unknown>): Promise<unknown>

// Get runtime status for all running channel plugins.
async getStatus(): Promise<unknown>

// Start a QR login flow for Zalo personal or WhatsApp plugins.
async pluginsQrLoginStart(id: string, body?: Record<string, unknown>): Promise<unknown>

// Poll QR login status for Zalo personal or WhatsApp plugins.
async getState(id: string): Promise<unknown>

// Cancel a QR login flow for Zalo personal or WhatsApp plugins.
async pluginsQrLoginCancel(id: string): Promise<unknown>

// Log out a QR-authenticated Zalo personal or WhatsApp plugin and clear stored credentials.
async pluginsLogout(id: string): Promise<unknown>

// Update safe channel policies for Zalo personal or WhatsApp plugins without overwriting credentials.
async pluginsPolicies(id: string, body?: Record<string, unknown>): Promise<unknown>

// Search a Zalo personal friends directory.
async listDirectoryFriends(id: string): Promise<unknown>

// Search a Zalo personal groups directory.
async listDirectoryGroups(id: string): Promise<unknown>

// List pending pairing codes for a channel plugin.
async listPluginPairingCodes(id: string): Promise<unknown>

// Generate a pairing code for a channel plugin.
async pluginsPairingCodes(id: string, body?: Record<string, unknown>): Promise<unknown>

// Approve a channel pairing code.
async pairingCodesApprove(id: string): Promise<unknown>

// Reject a channel pairing code.
async pairingCodesReject(id: string): Promise<unknown>

// List channel users for a plugin.
async listPluginUsers(id: string): Promise<unknown>

// Set authorization for a channel user.
async pluginsUsersAuthorization(id: string, userId: string, body?: Record<string, unknown>): Promise<unknown>

// Remove a channel user from a plugin.
async deleteUser(id: string, userId: string): Promise<unknown>
```
