# rtxexec

Run local commands with secrets stored in the RealTimeX app. Node.js 20+;
macOS, Linux, and Windows. Install with `npm install -g @realtimex/rtxexec`.

Create/manage secrets in Settings > Secrets or with the moderator
`realtimex-pp-cli`. This package deliberately has no vault-management commands.

```sh
rtxexec --env GH_TOKEN=secret://github-token -- gh issue list
rtxexec --stdin secret://registry-token -- docker login registry.example.com --username alice --password-stdin
rtxexec --secret token=secret://github-token -- curl -H 'Authorization: Bearer {{token}}' https://api.github.com/user
```

Run inside a RealTimeX terminal session. The app supplies
`REALTIMEX_TERMINAL_SESSION_TOKEN` and `REALTIMEX_BASE_URL` (ending in `/cli`).
`SERVER_URL` is a fallback. Connections are local only and never follow redirects.
Workspace authorization comes from the server's authenticated session, not a
caller-provided `RTX_WORKSPACE_SLUG`. Missing/disabled/out-of-scope values fail
before the child starts. Secrets are retrieved anew; there is no local cache.

The optional `run` subcommand is also accepted. Bindings precede `--`; everything after it is the executable and literal argument
array. Placeholder expansion happens once, inside arguments, with no shell eval.
Quote placeholders for your shell (single quotes in Bash, zsh, and PowerShell).
Percent-encode legacy names containing spaces in secret references. Environment
bindings affect only the child. `--stdin` sends the exact value without adding a
newline and closes stdin; without it, stdin is inherited.

The child receives the real value. Known plaintext, URI-encoded, JSON-escaped,
and base64 values are masked in UTF-8 stdout/stderr, including split chunks.
This reduces accidental disclosure; it does not prevent arbitrary child programs
from saving or transmitting secrets. Argument injection can expose values in
process inspection. Do not ask agents to retrieve raw secrets or bypass masking.

Exit codes are propagated. Signal exits use 128 + signal number. POSIX signals
are forwarded to the child process group; Windows uses Node's child termination
behavior and cannot promise POSIX process-group semantics. Output is piped, not a
PTY: full-screen tools and programs requiring an interactive TTY are unsupported.
Use native executables on Windows; invoke JavaScript CLIs as `node path/to/cli.js`
when the installed launcher is a .cmd/.bat file. Shell pipelines must be composed
explicitly; the wrapper does not interpret shell syntax.

`npm test` runs isolated fixtures. `npm pack --dry-run` validates package contents.

## Bound Himalaya execution (0.4.0 companion)

The email entry requires a matching host implementing `himalaya-execution@1`.
The released 0.3.0 package and an older host do not provide this bridge.
Choose an email Login through the host's private setup UI. The host owns its
credential ID/reference/password-field/account/config-target binding. Then a
newly authenticated terminal can use the non-secret selection:

```sh
rtxexec himalaya --plugin PLUGIN_ID --account work --binding BINDING_ID --operation folders
rtxexec himalaya --plugin PLUGIN_ID --account work --binding BINDING_ID \
  --operation envelopes --folder INBOX --page 1 --page-size 200 --query 'subject -invoice'
```

Other bounded operations are `move --from INBOX --to Archive --uids 1,2` and
`add-folder --folder Auto/Newsletters`. The caller must separately enforce its
mailbox policy and confirmation requirements. Omit `--binding` only for a
host-admitted existing unmanaged account; this does not migrate its auth command.
No arbitrary executable, configuration path, workspace authority or password is
accepted by the email entry.

Admission uses the current terminal token and a local nonredirecting connection.
The host must atomically validate identity, enabled state, scope, account and
target while resolving; the SDK cannot supply that server-side implementation.
The short-lived operation is revalidated before execution, before authentication,
periodically during execution and before returning results. Context loss cancels
the process. Participating config-file hashes are checked before launch and again
after the secret-free version probe. Only verified Himalaya v1.2.0 is supported
by this adapter; other versions produce a compatibility error. The email adapter's
real-binary proof covers macOS/Linux paths. Windows drive targets fail closed:
[v1.2.0's config parser](https://github.com/pimalaya/himalaya/blob/v1.2.0/src/cli.rs)
uses a colon delimiter. Windows target/auth-command support needs a separately
verified adapter; existing general rtxexec commands retain their platform support.

The shared runner strips RealTimeX and other API credentials, injects the selected
password into only the admitted Himalaya child and sets a binding marker. Its
fixed inner helper writes one exact line into Himalaya's private auth pipe;
CR/LF/NUL passwords are rejected and ordinary spaces are retained. Do not put
generic rtxexec or a `secret://` URI inside `backend.auth.cmd`: masking the helper
would destroy the authentication value. The host writes the fixed helper path
and non-secret binding ID. The host uses the same runner for desktop operations;
desktop execution does not borrow a terminal token or send a password to the UI.

Results are bounded JSON. Known password encodings are masked, and private
diagnostics become fixed auth/network/TLS/config/account codes. Cancellation,
timeout and output-limit failures remain distinct. Existing pass/GnuPG/keyring
location variables are retained only for unmanaged accounts. Credentials are
resolved for each admitted operation, never saved in config, arguments or a
local cache. This retains the normal trust in the selected local binary and
config commands; output masking cannot isolate malicious local code.

The host can consume the CJS package exports or bundle the identical fixed assets
before this companion is published. From this repository, use
`node rtxexec/scripts/export-himalaya-host.mjs --write --output /absolute/host/asset/directory`,
then the same command with `--check`. The source/version/hash manifest binds the
host copy to this companion; no SDK worktree path is needed at runtime. Recheck
the bundle whenever either source changes. This build step does not implement
the host principal, binding database, Secrets resolution or private selection UI.

Run the optional real binary proof only against its disposable loopback fixture:
`HIMALAYA_TEST_BIN=/absolute/path/to/himalaya npm test`. It checks the private
authentication pipe, synthetic rotation and an unmanaged helper without touching
the user's vault, account config or mailbox.


## Browser Login credentials (0.2.0)

Create a **Login** in RealTimeX Settings > Secrets (encrypted username/password,
login URL and exact allowed origins). Management belongs to the moderator CLI;
rtxexec only uses credentials. Browser operations require Node.js 22 or newer.

Prepare the page using agent-browser on your existing RealTimeX browser. Then:

```sh
rtxexec browser-tabs --cdp 9235
rtxexec browser-login secret://company-login --cdp 9235 --tab <target-id> \
  --username-selector '#username' --password-selector '#password' \
  --submit-selector 'button[type=submit]'
```

Use the full target ID from `browser-tabs`, not agent-browser's `t1`/`t2` alias.
The command never navigates or chooses a tab automatically. Each CSS selector must
match exactly one visible top-level form control. Iframe forms are not supported.
For two-step logins, specify only the username selector first, then prepare the
password step and run again with only its selector. Omit submit to fill only.
A `filled` or `submitted` result does not prove authentication: verify a non-secret
success state separately. MFA and CAPTCHA stay in the normal browser workflow.

This works with agent-browser 0.27.0 because it uses the local CDP connection
instead of unsupported credential-provider flags. Values are passed as CDP
arguments in an isolated execution context, never inserted into JavaScript source,
saved in another vault, or printed in normal output. Scope, enabled state and exact
origin are checked before resolution; the form's origin/action is rechecked during
filling. History records resolution with browser origin/target and terminal context,
not an assertion that login succeeded.

The destination/browser necessarily receives the values. Do not take snapshots,
screenshots, recordings, DOM-value reads, or network traces while credentials are
present. A page may display a username after login. This reduces accidental exposure;
it does not prevent intentional local extraction or malicious website behavior.


## Structured credential items

RealTimeX stores Login, Card, Identity, SSH key and Secure note items. Management
stays in Settings or the moderator CLI; rtxexec only uses saved values.
List metadata to discover `reference` and `fieldNames`. To select a field:

```sh
rtxexec --env API_TOKEN=secret://service#apiToken -- program
rtxexec --stdin secret://note#notes -- program
```

A Login can contain just a password, the built-in API key / Token (`apiToken`),
or custom fields; a username and website are optional for terminal use. New Login
defaults to password when present, otherwise `apiToken`; Secure note defaults to
notes. Existing scalar references keep their value. An explicit move into Password
or API key / Token preserves both default and `#value` references, including after
rotation.
Use explicit field references for Card, Identity and SSH items.

### Fill Card or Identity forms

Prepare a page with agent-browser, identify its visible top-level selectors,
and use the exact CDP target ID from `browser-tabs`:

```sh
rtxexec browser-fill secret://card --cdp 9235 --tab TARGET_ID \
  --field 'number=#card-number' --field 'securityCode=#cvv'
```

Only mapped fields are requested. The item's permitted origins and workspace
scope are enforced. Inputs, textareas and selects are supported; iframe forms
are not. This command never submits. Check non-secret status and perform any
submission separately within the authorized task. Avoid snapshots, recordings
and field-value reads while saved data is in the page. `browser-login` remains
available and now requests only the username/password fields selected.

### SSH and Git

```sh
rtxexec ssh secret://deploy-key -- ssh user@host
rtxexec ssh secret://deploy-key -- git fetch origin
```

Requires OpenSSH (and Git for Git commands). The app unlocks the saved key for
this execution. rtxexec writes it to a restricted temporary directory, supplies
the path to SSH or Git, and removes the directory when the child finishes or
fails. Unix uses directory mode 0700 and file mode 0600; Windows requires icacls
to restrict the directory before writing. Existing host-key verification stays
in effect. SIGKILL or a machine crash may prevent cleanup. The CLI keeps no
persistent vault or secret cache. Output masking is best effort; this is an
accidental-disclosure safeguard, not a boundary against deliberate local access.

## Linked SSO logins

A Login can keep its normal username/password and link multiple saved Login items
for SSO. Management uses `ssoCredentialIds` (moderator flag
`--sso-credential-ids id1,id2`; an empty flag clears links). Names and descriptions
identify the provider and account; no separate provider instructions are needed.

Use agent-browser to choose the matching sign-in button and reach the provider.
Then explicitly select the linked Login:

```sh
rtxexec browser-login secret://rtgit --sso secret://google \
  --cdp 9235 --tab TARGET_ID \
  --username-selector '#username' --password-selector '#password'
```

The server checks both items' enabled state and workspace scope, and the provider's
allowed website origin. It records usage for both without copying values into the
site item. Omitting `--sso` uses normal credentials; selection never automatically
follows further links. Ask when the provider/account is ambiguous, and handle
already signed-in sessions or MFA through the normal browser workflow.
