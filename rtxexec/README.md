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
