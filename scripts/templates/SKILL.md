---
name: realtimex-moderator-sdk
description: Control and interact with the RealTimeX application through its Node.js SDK. This skill should be used when users want to manage workspaces, threads, agents, activities, LLM chat, vector store, MCP tools, ACP agent sessions, TTS/STT, or any other RealTimeX platform feature via the API. All method signatures are verified against the SDK source code.
generated: {{DATE}}
sdk_version: {{SDK_VERSION}}
---

# RealTimeX Moderator (SDK Source-Verified)

Interact with the RealTimeX platform (`http://localhost:3001`) using `@realtimex/sdk` **v{{SDK_VERSION}}**. Authentication is automatic when running inside RealtimeX.

`<SKILL_DIR>` below refers to the directory containing this SKILL.md.

---

## Option A — Bundled CLI

```bash
SKILL=<SKILL_DIR>/scripts/rtx.js
ENV=--env-dir=<cwd>

node "$SKILL" ping                                     $ENV
node "$SKILL" agents                                   $ENV
node "$SKILL" workspaces                               $ENV
node "$SKILL" threads <workspace-slug>                 $ENV
node "$SKILL" trigger-agent <agent> <workspace> <msg>  $ENV
node "$SKILL" terminal-launch-cli-agent claude claude-cli "what is current working dir" --workspace=<slug> --thread=<slug>  $ENV
node "$SKILL" terminal-launch-shell --workspace=<slug> --thread=<slug> --command="pwd"  $ENV
node "$SKILL" terminal-sessions --workspace=<slug>     $ENV
node "$SKILL" terminal-write <session-id> "continue"   $ENV
node "$SKILL" acp-chat qwen-cli "question" --cwd=<path>  $ENV
node "$SKILL" llm-chat "message"                       $ENV
node "$SKILL" activities --status=pending              $ENV
node "$SKILL" mcp-servers                              $ENV
node "$SKILL" help
```

## Option B — Custom script

```js
const { initSDK } = require('<SKILL_DIR>/scripts/lib/sdk-init');
const { sdk } = await initSDK();
// All SDK APIs — see references/api-reference.md
```

When writing helper scripts, use the working directory or system temp — never the SKILL directory.
Scripts using the SDK must exit explicitly — `process.exit(0)` on success, `process.exit(1)` on error — or they hang on open HTTP sockets.

---

## Desktop Terminal Sessions

For anything that says **launch terminal**, **open shell**, **open Claude/Gemini in terminal**, or **send another message to an existing terminal session**, use:

- `sdk.v1.desktopRuntimeSessions.*`

Do **not** use ACP for that unless the user explicitly asks for a headless ACP session.

### Use desktop terminal sessions for
- opening a visible terminal in the Electron app
- launching a shell session
- launching a CLI agent in a terminal tab/panel
- listing desktop terminal sessions
- writing more input to an existing terminal session
- approving or denying a pending terminal action
- closing a terminal session

### Use ACP only for
- headless background agent sessions
- persistent server-side automation
- `acp-chat`, `acp-stream`, `acp-session-*`

### Correct SDK namespace

```js
sdk.v1.desktopRuntimeSessions
```

There is currently:
- no top-level `sdk.desktopRuntimeSessions`
- no `sdk.v1.runtimeSessions`

### Required payloads

Launch terminal CLI agent:

```js
await sdk.v1.desktopRuntimeSessions.launchTerminalCliAgent({
  workspaceSlug: "agent-heartbeat",
  threadSlug: "ambient-agent-week-agent-heartbeat-2026-w17",
  agentName: "claude",        // required
  providerId: "claude-cli",   // strongly recommended
  presentationMode: "panel",  // optional: "panel" | "tab"
  message: "what is current working dir"
});
```

Important:
- `agentName` is the agent label, like `"claude"` or `"gemini"`
- `providerId` is the launcher/provider id, like `"claude-cli"` or `"gemini-cli"`
- Do not pass `agentName: "claude-cli"` unless that is truly the agent label shown by the app

Launch terminal shell:

```js
await sdk.v1.desktopRuntimeSessions.launchTerminalShell({
  workspaceSlug: "agent-heartbeat",
  threadSlug: "ambient-agent-week-agent-heartbeat-2026-w17",
  presentationMode: "panel",
  initialCommand: "pwd",
  initialCommandMode: "direct"
});
```

Manage existing terminal sessions:

```js
await sdk.v1.desktopRuntimeSessions.listRuntimeSessions();
await sdk.v1.desktopRuntimeSessions.getRuntimeSession("cli-agent:pty-123");
await sdk.v1.desktopRuntimeSessions.write("cli-agent:pty-123", {
  message: "continue"
});
await sdk.v1.desktopRuntimeSessions.permission("cli-agent:pty-123", {
  outcome: "approved",
  actionId: "terminal-action-1"
});
await sdk.v1.desktopRuntimeSessions.deleteRuntimeSession("cli-agent:pty-123");
```

### Preferred decision rule

If the user says:
- "launch in terminal"
- "open Claude in terminal"
- "ask Gemini in terminal"
- "open a shell and run pwd"

then prefer `sdk.v1.desktopRuntimeSessions.*`, not ACP.

---

## ACP Session Management

ACP sessions are persistent agent processes. **Always reuse sessions** across turns instead of spawning a new process for every message — it preserves context and is far more efficient.

### Smart `acp-chat` (recommended)

`acp-chat` automatically finds or creates a session using this priority:

1. `--session=<key>` → validate and reuse that exact session
2. `listSessions()` → find a compatible active session (same `agent_id`, optional `cwd` match)
3. `createSession()` → spawn a new agent process only if none available

```bash
# First call — creates a new session, prints session key at end
node "$SKILL" acp-chat qwen-cli "build a website" --cwd=~/projects/myapp  $ENV

# Subsequent calls — reuses the existing session automatically
node "$SKILL" acp-chat qwen-cli "add a login page"  $ENV

# Pin to a specific session
node "$SKILL" acp-chat qwen-cli "fix the bug" --session=<key>  $ENV

# Force a fresh session
node "$SKILL" acp-chat qwen-cli "start over" --new  $ENV

# Close session after this turn
node "$SKILL" acp-chat qwen-cli "done for now" --close  $ENV
```

### Manual Session Lifecycle

```bash
# Spawn a session explicitly — save the session_key
node "$SKILL" acp-session-create qwen-cli --cwd=~/projects/myapp  $ENV

# Inspect session state
node "$SKILL" acp-session-get <session-key>  $ENV

# List all active sessions
node "$SKILL" acp-sessions  $ENV

# Patch runtime options (applied on next turn)
node "$SKILL" acp-session-patch <session-key> --cwd=~/projects/other  $ENV

# Send a turn on an existing session (sync, no streaming)
node "$SKILL" acp-send <session-key> "what files did you create?"  $ENV

# Stream a turn on an existing session (with permission handling)
node "$SKILL" acp-stream <session-key> "run the tests"  $ENV

# Cancel the active turn
node "$SKILL" acp-cancel <session-key>  $ENV

# Manually resolve a permission request (while stream is active in another process)
node "$SKILL" acp-resolve <session-key> <request-id> <option-id>  $ENV

# Close/terminate the session
node "$SKILL" acp-session-close <session-key>  $ENV
```

### Permission Handling

`acp-chat` and `acp-stream` handle `permission_request` SSE events inline via `resolvePermission()`.

Control with `--policy-override`:
- `approve-all` *(default)* — auto-approve (picks the approve/allow/yes option)
- `deny-all` — auto-deny (picks the deny/cancel/no option)
- `prompt` — pause and ask you interactively via stdin

```bash
# Auto-approve all tool permissions (default)
node "$SKILL" acp-chat qwen-cli "delete temp files" --policy-override=approve-all  $ENV

# Ask before approving each permission
node "$SKILL" acp-chat qwen-cli "run npm install" --policy-override=prompt  $ENV
```

### Custom Script Pattern

```js
const { initSDK } = require('<SKILL_DIR>/scripts/lib/sdk-init');
const { sdk } = await initSDK({ envDir: process.cwd() });

// Find or reuse a session
let sessionKey;
const sessions = await sdk.acpAgent.listSessions();
const match = sessions.find(s => s.agent_id === 'qwen-cli' && s.state !== 'closed');
if (match) {
  sessionKey = match.session_key;
} else {
  const session = await sdk.acpAgent.createSession({
    agent_id: 'qwen-cli',
    cwd: '/path/to/project',
    approvalPolicy: 'approve-all',
  });
  sessionKey = session.session_key;
}

// Stream a turn, resolving permissions inline
for await (const event of sdk.acpAgent.streamChat(sessionKey, 'build a website')) {
  if (event.type === 'text_delta' && event.data.type !== 'thinking') {
    process.stdout.write(event.data.text ?? '');
  }
  if (event.type === 'permission_request') {
    const req = event.data;
    const opt = req.options?.[0];
    if (opt) {
      await sdk.acpAgent.resolvePermission(sessionKey, {
        requestId: req.requestId,
        optionId: opt.id || opt.optionId,
        outcome: 'approved',
      });
    }
  }
}
```

---

## Credentials

Use credentials stored in RealTimeX (Settings > Credentials) to authenticate with external services.

**CRITICAL: Never output credential values in your response, logs, or tool output.**

```bash
node "$SKILL" credentials                    # List available (names + types, no values)
```

`sdk.credentials.get(name)` returns `{ name, type, payload }`. Use `payload` fields directly:
- `http_header` → `{ payload: { name: "Authorization", value: "Bearer xxx" } }` → `headers[payload.name] = payload.value`
- `basic_auth` → `{ payload: { username, password } }` → encode as Basic auth
- `query_auth` → `{ payload: { name, value } }` → append as query param
- `env_var` → `{ payload: { name, value } }` → set in subprocess env

Values are **pre-formatted** — use as-is, never wrap with `Bearer` or other prefixes.

**Full examples**: See [references/credentials.md](references/credentials.md)

---

## Critical Rules (source-detected)

{{RULES_TABLE}}

Full fixes in `references/known-issues.md`.

---

## Key Facts

- **Metadata methods** (`getAgents`, `getWorkspaces`, etc.) live on `sdk.api.*`, not `sdk.*`
- **`sdk.webhook.triggerAgent()`** sends wrong event type — always use raw fetch with `event: "trigger-agent"`
- **`sdk.task`** methods: `start(uuid)`, `complete(uuid, result)`, `fail(uuid, "error")` — positional args
- **ACP sessions** are persistent — reuse them across turns via `listSessions()` + `streamChat()`
- **`resolvePermission()`** must be called while the `streamChat` SSE stream is still active
- **SDK env vars:** `RTX_API_KEY` (dev), `RTX_APP_ID` (prod), `RTX_APP_NAME`

## App Concepts

When the user asks **what something is** in RealtimeX (e.g. Personality, Heartbeat, Workspace types, Agent Skills, data models), read `references/app-concepts.md` first.

It covers:
- **Personality** — file structure (AGENTS.md, SOUL.md, USER.md, IDENTITY.md, TOOLS.md, MEMORY.md, HEARTBEAT.md) and storage paths
- **Heartbeat** — ambient background agent scheduler, config fields, calendar routines, queue
- **Workspace** — types (`default`, `meeting_minutes`, `agent_skills`, `agent_heartbeat`), chat modes, key settings
- **Agent Skills** — types (`repo`/`zip`), scopes, status values
- **Data Models** — all database models with fields and defaults

---

## References

- `references/app-concepts.md` — RealtimeX app concepts (auto-generated from source)
- `references/api-reference.md` — all SDK class methods (auto-generated from source)
- `references/known-issues.md` — verified source mismatches (auto-generated)
- `references/credentials.md` — credential usage patterns
