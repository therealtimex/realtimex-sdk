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
rtxexec --env API_TOKEN=secret://service#token -- program
rtxexec --stdin secret://note#notes -- program
```

A Login can contain just a password or custom token fields; a username and
website are optional for terminal use. Existing scalar references still resolve
their value. New Login defaults to password and Secure note defaults to notes.
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
