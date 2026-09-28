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
