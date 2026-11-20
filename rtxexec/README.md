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

## Himalaya integration withdrawn (0.5.0)

The 0.4.0 `rtxexec himalaya` command and its `./himalaya/runner` and
`./himalaya/password` exports were a companion to a host contract
(`himalaya-execution@1`) that will not ship. No released RealTimeX app
implements it, so the command could only fail. Since 0.5.0 every
`rtxexec himalaya …` invocation exits with status 1 and writes this one JSON
line to stdout, without reading its options or contacting the app:

```json
{"ok":false,"code":"RTXEXEC_HIMALAYA_DEPRECATED","message":"Run himalaya directly with keyring/auth-command credentials, or use generic rtxexec --env/--stdin secret:// bindings with a compatible consumer; see the rtxexec README."}
```

To work with email from a RealTimeX terminal instead:

- Run the standalone `himalaya` CLI directly, with credentials from Himalaya's
  own keyring or auth-command (`backend.auth.cmd`) configuration.
- Use generic `--env`/`--stdin secret://…` bindings only with a program that
  actually reads its credential from that variable or from stdin. Himalaya
  does not read an arbitrary password variable or raw stdin on its own.
- Do not use generic rtxexec as a password-printing `backend.auth.cmd`. Output
  masking replaces the printed value, so authentication would fail.

Generic execution is unchanged: `rtxexec --env … -- himalaya …` runs a binary
named `himalaya` like any other executable.


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
rtxexec ssh secret://box -- ssh                      # saved user, host and port
rtxexec ssh secret://box -- ssh {{target}} uptime    # saved destination plus a remote command
rtxexec ssh secret://box -- ssh -p 2222 user@other   # an explicit destination wins
rtxexec ssh secret://deploy-key -- git fetch origin
```

An SSH login item holds a private key, a password, or both, and optionally a
username, host and port. Requires OpenSSH (and Git for Git commands).

**Key.** The app unlocks the saved key for this execution. rtxexec writes it to
a restricted temporary directory and passes it with `-i`, `IdentitiesOnly=yes`
and `IdentityAgent=none`.

**Password.** Needs OpenSSH 8.4 or later (`ssh -V`); older versions fail before
anything is written or launched. rtxexec writes the password to a file in the
same temporary directory, plus an askpass helper that never contains the
password. SSH is started with `SSH_ASKPASS` pointing at the helper and
`SSH_ASKPASS_REQUIRE=force`. The helper answers only password prompts (password
and keyboard-interactive); any other prompt, such as "continue connecting
(yes/no)?", is refused. The password is never in the child's arguments or
environment. A password-only login disables public-key authentication so agent
keys cannot cause "Too many authentication failures"; key plus password tries the
key first. For Git, `GIT_ASKPASS` points at a helper that always refuses, so
the password cannot be sent to an HTTPS remote. Do not pass `BatchMode=yes`; it
turns askpass off.

**Host keys.** Host-key verification stays on. Add the host key first (for
example with a manual `ssh` or `ssh-keyscan` you checked), or pass your own
`-o StrictHostKeyChecking=accept-new`.

**Destination.** For `ssh` only, rtxexec reads the arguments with OpenSSH's
option grammar. With no destination, it adds the saved host, plus `-p port` and
`-l username` when saved. A destination of exactly `{{target}}` becomes the saved
host the same way; `{{target}}` without a saved host is an error. Any other
destination is used as given and nothing is added. Your own `-p` or
`-o Port=` (and `-l` or `-o User=`) win over the saved port (and username). Git
always uses the remote URL.

**Cleanup.** The directory is mode 0700 with 0600 files on Unix; Windows
requires icacls to restrict it before writing. It is removed when the child
finishes, fails or is interrupted (SIGINT/SIGTERM are forwarded). SIGKILL or a
machine crash may prevent cleanup. The CLI keeps no persistent vault or secret
cache. The key and password are masked in output; masking is best effort, an
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

## Changelog

### 0.5.0

- Breaking: `rtxexec himalaya` is withdrawn. Every invocation returns
  `RTXEXEC_HIMALAYA_DEPRECATED` with exit status 1 (see above).
- Breaking: the `./himalaya/runner` and `./himalaya/password` exports are
  removed. The package is CLI-only and exposes no module entry points.
- Removed the Himalaya host asset exporter. The companion contract document is
  now a withdrawal notice.
- Generic `--env`/`--secret`/`--stdin`, `ssh` and browser commands are unchanged.
