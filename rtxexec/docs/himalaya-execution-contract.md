# Himalaya execution companion contract (withdrawn)

**Status: withdrawn. Do not implement.** `himalaya-execution@1` will not ship.

`@realtimex/rtxexec@0.4.0` included a managed `rtxexec himalaya` command and
host assets for this contract. They relied on host routes
`POST /cli/email/himalaya/admit` and `POST /cli/email/himalaya/validate`, which
no released RealTimeX app provides. The host side was dropped for two reasons:

- Email plugins run on the RealTimeX app without email-specific host support.
- The v1 admission response returned the decrypted mailbox password in its JSON
  body, readable by any process holding the terminal session token.

`@realtimex/rtxexec@0.5.0` removes the command implementation, the
`./himalaya/runner` and `./himalaya/password` exports and the host asset
exporter. `rtxexec himalaya` now returns `RTXEXEC_HIMALAYA_DEPRECATED` without
contacting the app. The earlier text of this contract remains in git history
for reference only.

For the replacement path, see "Himalaya integration withdrawn (0.5.0)" in the
[rtxexec README](../README.md#himalaya-integration-withdrawn-050).

Tracking: realtimex-ai-app#2437. Supersedes #20.
