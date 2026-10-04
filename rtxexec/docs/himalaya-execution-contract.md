# Himalaya execution companion contract

`@realtimex/rtxexec` 0.4.0 implements the terminal client and shared runner for
`himalaya-execution@1`. This document defines the companion host boundary; the
host implementation and its independent admission/Secrets tests remain required.
An older host fails closed. No package publication is part of this change.

## Terminal admission

POST `/cli/email/himalaya/admit`, locally authenticated with the current
`RealtimeX-Terminal` token. The host verifies the live registry, derives the
workspace/thread/user and rejects other authentication types at this boundary.
The body contains only:

- `contractVersion: "himalaya-execution@1"`
- `pluginId`, `account`, optional `bindingId`
- `operation: folders | envelopes | move | add-folder`
- The selected operation's bounded fields: `folder`, `page`, `pageSize`, `query`,
  or `from`, `to`, `uids`.

No caller workspace/thread, credential values, arbitrary binary/config paths,
command text or unverified session object is accepted. Plugin ID is a selector;
the host independently checks plugin activation and destination access. This is
the installed record ID (`PluginAPI.pluginId`), distinct from a manifest ID.

Before resolving a managed password the host validates the stored credential
ID/reference/explicit password field, Login kind, enabled/deleted/scope state,
account association, version-aware target identity, participating file hashes,
helper command and binding revision together inside trusted resolution. Lookup
by name alone is insufficient. A renamed or recreated item cannot silently
replace the selection. A changed credential/binding/target invalidates readiness
and requires a new check. An unmanaged account admits its existing auth command
with no password; a managed account cannot downgrade by omitting its binding.
The host must deny unsupported platform/target representations before resolving.
In particular v1.2.0's colon config delimiter conflicts with Windows drive paths;
the shared runner refuses them with `EMAIL_PLATFORM_UNSUPPORTED`. A separate
Windows target/helper adapter remains required, rather than guessing a separator.

Successful response:

- `success: true`, matching `contractVersion`
- `operationId`: opaque non-secret identifier, bound to this verified terminal's
  ID/generation/workspace, plugin, account, operation and admitted revisions
- `expiresAt`: ISO expiry no more than 120 seconds after admission
- `plan`: host-selected absolute `binary`, ordered absolute `configPaths`,
  `{path, revision}` SHA-256 `configRevisions`, aggregate SHA-256 `targetRevision`,
  matching `account`/`bindingId`, and managed SHA-256 `bindingRevision`
- `password`: only for the managed terminal child, privately consumed in memory
  by the SDK runner, never displayed, saved, cached or included in diagnostics

Admission responses must be private and non-cacheable, excluded from response
logging/traces and persistent operation records. Agent commands call the SDK
adapter rather than issuing raw admission/resolution HTTP requests.
The host stores no password in its operation record. A safe error response has
`success: false` and one fixed denial code. No upstream diagnostic is interpreted
as user-facing text. Response bodies are bounded to 512 KiB by the SDK.

## Live validation

POST `/cli/email/himalaya/validate` with matching `contractVersion` and
`operationId`, authenticated again with the run's current terminal token. The
host rechecks registry identity/generation, expiry, plugin activation, workspace
access and admitted credential/binding/target revisions. An operation ID by
itself grants no authority. Success returns the matching contract/operation ID.

The client validates before launch, the shared runner validates again before its
secret-free version probe and before authenticated execution, the client checks
every second during execution and before returning data. Denial aborts the child
process group and discards a late result. The same fixed runner checks local file
hashes before the probe and before authentication. No setup token is persisted
or borrowed by a later scheduled run.

## Mutation receipts and interruption

The shared runner invokes the synchronous `onExecutionStart` callback only when
the authenticated command emits its successful spawn event, never for the
credential-free version probe. Host and terminal consumers retain the original
admitted operation/run identity before that point. No automatic retry is made.

For a move/add-folder, terminal success includes `operationId` and
`outcome: "confirmed"`. An admitted failure includes the same ID and
`outcome: "not_started"` if the command never successfully spawned, otherwise
`outcome: "uncertain"`. Pre-admission failures have no operation ID. Context
loss, expiry, timeout or a final validation failure after child success does
not prove that a started mutation had no mailbox effect. A caller must retain
its uncertain receipt and reconcile the original UIDs/folders before retrying,
including when a process terminates without delivering a result. These fields
contain no password or child diagnostic. Desktop execution must retain the
same phase/identity semantics rather than treating cancellation as rollback.

## Desktop companion

The bounded host `PluginAPI.email.executeHimalaya` capability uses an authenticated
host action's internal plugin/workspace/operation principal. A body-supplied slug,
an API key, a fabricated terminal or a retained setup token cannot substitute for
that principal. Async continuation remains bound to the admitted operation and
is revalidated/cancelled when its context changes. Resolve and inject privately
through the same fixed runner; desktop responses contain only its safe result,
never the password. Existing public secret resolution stays terminal-only.

Typed usage history records the actual terminal or host-action principal,
workspace, plugin, operation and credential field. A desktop audit must not
invent a terminal session ID. Use the same binding and version-aware target for
desktop checks, scans, moves/undo, terminal commands and authenticated schedules.
No-context headless execution fails closed.

## Shared fixed assets

The host may bundle `runner.cjs` and `password.cjs` from this source using
`scripts/export-himalaya-host.mjs`; its version/hash manifest and `--check` prove
parity without an unpublished registry dependency or runtime worktree path. The
host must use a trusted fixed helper launch path appropriate to its shipped
Node runtime and retain the SDK source/license attribution. Admission, binding,
target/config writer, audit and private selection UI are host work, not supplied
by copying these files.

The host writes the non-secret binding ID into the auth command. The runner
probes actual Himalaya v1.2.0 without a password, removes control credentials and
injects only `RTX_HIMALAYA_BINDING_ID`/`RTX_HIMALAYA_PASSWORD` for the selected
child. The helper's unmasked private pipe is inside the outer masking boundary.
Read operations return bounded sanitized JSON; successful mutations return no
child text. Fixed auth/network/TLS/config/account/helper/page codes are distinct
from Secrets denials, cancellation, timeout and output limits.
