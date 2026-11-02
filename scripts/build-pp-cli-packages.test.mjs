import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  FORBIDDEN_HELPER_FILE,
  FORBIDDEN_HELPER_SOURCE,
  RATE_LIMIT_HELPER_FILE,
  RATE_LIMIT_HELPER_SOURCE,
  RATE_LIMIT_MAX_RETRIES,
  RATE_LIMIT_MAX_WAIT_SECONDS,
  RATE_LIMIT_TOTAL_WAIT_SECONDS,
  patchCliBaseURLPathJoin,
  patchCliCredentialReference,
  patchCliDelegateContracts,
  patchCliRetryAfterAndForbidden,
  patchCliTerminalSessionAuth,
} from './build-pp-cli-packages.mjs';
import { patchWorkspacePluginClient } from './workspace-plugin-cli-contract.mjs';

function writeFixture(sourceDir) {
  const configDir = path.join(sourceDir, 'internal', 'config');
  const clientDir = path.join(sourceDir, 'internal', 'client');
  const cliDir = path.join(sourceDir, 'internal', 'cli');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(clientDir, { recursive: true });
  fs.mkdirSync(cliDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, 'config.go'),
    `package config

import (
\t"fmt"
\t"os"
\t"strings"
)

type Config struct {
\tRealtimexAppIdAuth string \`toml:"app_id_auth"\`
\tAuthHeaderVal string
\tAccessToken string
\tAuthSource string
}

func Load() *Config {
\tcfg := &Config{}
\tif v := os.Getenv("REALTIMEX_APP_ID_AUTH"); v != "" {
\t\tcfg.RealtimexAppIdAuth = v
\t\tcfg.AuthSource = "env:REALTIMEX_APP_ID_AUTH"
\t}
\treturn cfg
}

func (c *Config) AuthHeader() string {
\treturn c.RealtimexAppIdAuth
}
`
  );
  fs.writeFileSync(
    path.join(clientDir, 'client.go'),
    `package client

import (
\t"context"
\t"fmt"
\t"net/http"
\t"os"
)

type Config struct {
\tRealtimexAppIdAuth string
}

func (c *Config) UsesTerminalSessionToken() bool { return false }

type Client struct {
\tConfig *Config
}

func (c *Client) request(req *http.Request, authHeader string) {
\t\tif authHeader != "" {
\t\t\treq.Header.Set("x-app-id", authHeader)
\t\t}
}

func (c *Client) redirect(req *http.Request) {
\t\t\treq.Header.Del("x-app-id")
\t\t\tif h, err := c.authHeader(req.Context()); err == nil && h != "" {
\t\t\t\treq.Header.Set("x-app-id", h)
\t\t\t}
}

func (c *Client) authHeader(context.Context) (string, error) { return "", nil }

func (c *Client) credentials() {
\taddCredential := func(string) {}
\t\taddCredential(c.Config.RealtimexAppIdAuth)
}

func (c *Client) dryRun(authHeader string) {
\tif authHeader != "" {
\t\tfmt.Fprintf(os.Stderr, "  %s: %s\\n", "x-app-id", maskToken(authHeader))
\t}
}

func maskToken(value string) string { return value }
`
  );
  fs.writeFileSync(
    path.join(cliDir, 'root.go'),
    `package cli

type Config struct{}
type Client struct{}

type rootFlags struct {
\tconfigPath string
}

type flagSet struct{}
func (f *flagSet) StringVar(*string, string, string, string) {}
type command struct{}
func (c *command) PersistentFlags() *flagSet { return &flagSet{} }

func flags(rootCmd *command, flags *rootFlags) {
\trootCmd.PersistentFlags().StringVar(&flags.configPath, "config", "", "Config file path")
}

func configErr(error) error { return nil }
func loadConfig(string) (*Config, error) { return &Config{}, nil }
func (c *Config) UseCredentialReference(string) error { return nil }
func newClient(f *rootFlags) (*Client, error) {
\tcfg, err := config.Load(f.configPath)
\tif err != nil {
\t\treturn nil, configErr(err)
\t}
\t_ = cfg
\treturn &Client{}, nil
}
`
  );
}

test('patches generated CLI auth to prefer the managed terminal token', () => {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-cli-auth-'));
  try {
    writeFixture(sourceDir);
    patchCliTerminalSessionAuth(sourceDir);

    const config = fs.readFileSync(
      path.join(sourceDir, 'internal', 'config', 'config.go'),
      'utf8'
    );
    const client = fs.readFileSync(
      path.join(sourceDir, 'internal', 'client', 'client.go'),
      'utf8'
    );

    assert.match(config, /REALTIMEX_TERMINAL_SESSION_TOKEN/);
    assert.match(config, /else if v := os\.Getenv\("REALTIMEX_APP_ID_AUTH"\)/);
    assert.match(config, /func \(c \*Config\) UsesTerminalSessionToken\(\) bool/);
    assert.match(client, /"Authorization", "RealtimeX-Terminal "\+authHeader/);
    assert.match(client, /req\.Header\.Del\("Authorization"\)/);
    assert.match(client, /addCredential\(c\.Config\.RealtimexTerminalSessionToken\)/);
  } finally {
    fs.rmSync(sourceDir, { recursive: true, force: true });
  }
});

test('patches generated CLI auth to resolve a scoped credential by keychain reference', () => {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-cli-credential-ref-'));
  try {
    writeFixture(sourceDir);
    patchCliTerminalSessionAuth(sourceDir);
    patchCliCredentialReference(sourceDir);

    const config = fs.readFileSync(
      path.join(sourceDir, 'internal', 'config', 'config.go'),
      'utf8'
    );
    const client = fs.readFileSync(
      path.join(sourceDir, 'internal', 'client', 'client.go'),
      'utf8'
    );
    const root = fs.readFileSync(
      path.join(sourceDir, 'internal', 'cli', 'root.go'),
      'utf8'
    );

    assert.match(config, /readCliCredential\("ai\.realtimex\.cli\.credentials", reference\)/);
    assert.match(config, /wincred\.GetGenericCredential\(service \+ "\/" \+ reference\)/);
    assert.match(config, /"account":\s+reference/);
    assert.match(config, /secretService\.SearchItems\(collection/);
    assert.match(config, /return keyring\.Get\(service, reference\)/);
    assert.match(config, /func \(c \*Config\) UsesCredentialReference\(\) bool/);
    assert.match(client, /"Authorization", "Bearer "\+authHeader/);
    assert.match(client, /addCredential\(c\.Config\.CliCredentialSecret\)/);
    assert.match(client, /headerValue = "Bearer " \+ authHeader/);
    assert.match(root, /"credential-ref"/);
    assert.match(root, /cfg\.UseCredentialReference\(f\.credentialRef\)/);
  } finally {
    fs.rmSync(sourceDir, { recursive: true, force: true });
  }
});

test('generated Keytar readers compile for Linux and Windows', () => {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-cli-keytar-readers-'));
  try {
    writeFixture(sourceDir);
    patchCliTerminalSessionAuth(sourceDir);
    patchCliCredentialReference(sourceDir);
    execFileSync('go', ['mod', 'init', 'keytar-reader-contract'], {
      cwd: sourceDir,
      stdio: 'ignore',
    });
    execFileSync('go', ['get', 'github.com/zalando/go-keyring@v0.2.8'], {
      cwd: sourceDir,
      stdio: 'ignore',
    });
    execFileSync('go', ['mod', 'tidy'], {
      cwd: sourceDir,
      stdio: 'ignore',
    });

    for (const goos of ['linux', 'windows']) {
      execFileSync('go', ['build', './internal/config'], {
        cwd: sourceDir,
        env: { ...process.env, GOOS: goos, GOARCH: 'amd64', CGO_ENABLED: '0' },
        stdio: 'ignore',
      });
    }
  } finally {
    fs.rmSync(sourceDir, { recursive: true, force: true });
  }
});

test('avoids duplicating the cli prefix at the generated client boundary', () => {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-cli-base-url-'));
  const clientDir = path.join(sourceDir, 'internal', 'client');
  try {
    fs.mkdirSync(clientDir, { recursive: true });
    fs.writeFileSync(
      path.join(clientDir, 'client.go'),
      `package client

import "strings"

type Client struct {
\tBaseURL  string
\tBasePath string
}

type Config struct {
\tBaseURL  string
\tBasePath string
}

func normalizeBasePath(value string) string {
\treturn strings.TrimRight(value, "/")
}

func newHTTPClient(int, any) any { return nil }

func New(cfg *Config, timeout int) *Client {
\thttpClient := newHTTPClient(timeout, nil)
\tc := &Client{
\t\tBaseURL:  strings.TrimRight(cfg.BaseURL, "/"),
\t\tBasePath: normalizeBasePath(cfg.BasePath),
\t}
\treturn c
}
`
    );

    patchCliBaseURLPathJoin(sourceDir);

    const client = fs.readFileSync(
      path.join(clientDir, 'client.go'),
      'utf8'
    );
    assert.match(client, /strings\.HasSuffix\(baseURL, basePath\)/);
    assert.match(client, /basePath = ""/);
    assert.match(client, /BaseURL:\s+baseURL/);
    assert.match(client, /BasePath:\s+basePath/);
  } finally {
    fs.rmSync(sourceDir, { recursive: true, force: true });
  }
});

function writeDelegateFixture(sourceDir) {
  const clientDir = path.join(sourceDir, 'internal', 'client');
  const cliDir = path.join(sourceDir, 'internal', 'cli');
  fs.mkdirSync(clientDir, { recursive: true });
  fs.mkdirSync(cliDir, { recursive: true });
  fs.writeFileSync(
    path.join(clientDir, 'client.go'),
    `package client

import (
\t"context"
\t"strings"
)

type Client struct{}
func isMutatingVerb(method string) bool { return method == "POST" }
func (c *Client) doInternal(ctx context.Context, method, path string, params map[string]string, body any, headerOverrides map[string]string, readOnlyIntent bool) {
\tconst maxRetries = 3
\t_ = maxRetries
\t_ = strings.TrimSpace(path)
}
`
  );
  fs.writeFileSync(
    path.join(cliDir, 'helpers.go'),
    `package cli

import (
\t"encoding/json"
\t"errors"
\t"fmt"
\t"os"
\t"strings"
\t"fixture/internal/client"
\t"fixture/internal/cliutil"
)

type rootFlags struct { asJSON bool; idempotent bool }
type cliError struct{}
func (*cliError) Error() string { return "" }
func apiErr(err error) error { return err }
func authErr(err error) error { return err }
func notFoundErr(err error) error { return err }
func rateLimitErr(err error) error { return err }
func writeNoop(*rootFlags, string, string) error { return nil }
func ExitCode(error) int { return 5 }

func writeAPIErrorEnvelope(flags *rootFlags, err error, code int) {
\tif flags == nil || !flags.asJSON {
\t\treturn
\t}
\t_ = json.NewEncoder(os.Stdout).Encode(map[string]any{
\t\t"error": err.Error(),
\t\t"code":  code,
\t})
}

// classifyAPIError maps API errors to structured exit codes with actionable hints.
func classifyAPIError(err error, flags *rootFlags) error {
\tvar typed *cliError
\tif errors.As(err, &typed) {
\t\treturn err
\t}

\tmsg := err.Error()
\tswitch {
\tcase strings.Contains(msg, "HTTP 409"):
\t\tif flags != nil && flags.idempotent {
\t\t\treturn writeNoop(flags, "already_exists", "already exists (no-op)")
\t\t}
\t\tclassified := apiErr(err)
\t\twriteAPIErrorEnvelope(flags, classified, ExitCode(classified))
\t\treturn classified
\tcase errors.Is(err, client.ErrPlaceholderCredential):
\t\treturn authErr(err)
\tcase strings.Contains(msg, "HTTP 400") && cliutil.LooksLikeAuthError(msg):
\t\treturn authErr(fmt.Errorf("%w", err))
\tcase strings.Contains(msg, "HTTP 401"):
\t\treturn authErr(err)
\tcase strings.Contains(msg, "HTTP 403"):
\t\treturn authErr(err)
\tcase strings.Contains(msg, "HTTP 404"):
\t\treturn notFoundErr(err)
\tcase strings.Contains(msg, "HTTP 429"):
\t\treturn rateLimitErr(err)
\tdefault:
\t\treturn apiErr(err)
\t}
}

// classifyDeleteError maps DELETE errors.
`
  );
  fs.writeFileSync(
    path.join(cliDir, 'promoted_save-delegate-policy-draft.go'),
    `package cli

func save(cmd command) {
\tbody := map[string]any{}
\tbodyExpectedRevision := 0
\t\t\tif bodyExpectedRevision != 0 {
\t\t\t\tbody["expectedRevision"] = bodyExpectedRevision
\t\t\t}
\t_ = body
\t_ = cmd
}
`
  );
  fs.writeFileSync(
    path.join(cliDir, 'promoted_activate-delegate-policy.go'),
    `package cli

import "fmt"

type command struct{}
type flags struct{}
func (command) Flags() flags { return flags{} }
func (flags) Changed(string) bool { return false }
func (flags) StringVar(*string, string, string, string) {}
type descriptor struct { Use string; Example string }
func replacePathParam(path, name, value string) string { return path }

func activate(cmd command) error {
\tvar flagCandidateId string
\tbody := map[string]any{}
\tbodyExpectedAgentConfigRevision := 0
\tbodyExpectedAuthorityEpoch := 0
\tbodyExpectedDraftRevision := 0
\tmeta := descriptor{
\t\tUse:         "activate-delegate-policy <instanceId>",
\t\tExample:     "realtimex-pp-cli activate-delegate-policy instance --candidate-id candidate",
\t}
\t_ = meta
\t\t\tif !cmd.Flags().Changed("candidate-id") && !flags.dryRun {
\t\t\t\treturn fmt.Errorf("required flag \\"%s\\" not set", "candidate-id")
\t\t\t}
\tpath := "/activate-delegate-policy/{instanceId}/{candidateId}"
\t\t\tpath = replacePathParam(path, "candidateId", fmt.Sprintf("%v", flagCandidateId))
\t\t\tif bodyExpectedAgentConfigRevision != 0 {
\t\t\t\tbody["expectedAgentConfigRevision"] = bodyExpectedAgentConfigRevision
\t\t\t}
\t\t\tif bodyExpectedAuthorityEpoch != 0 {
\t\t\t\tbody["expectedAuthorityEpoch"] = bodyExpectedAuthorityEpoch
\t\t\t}
\t\t\tif bodyExpectedDraftRevision != 0 {
\t\t\t\tbody["expectedDraftRevision"] = bodyExpectedDraftRevision
\t\t\t}
\tcmd.Flags().StringVar(&flagCandidateId, "candidate-id", "", "Candidate id")
\t_ = body
\t_ = path
\treturn nil
}
`
  );
}

test('accepts app specs without retired Delegate policy commands', () => {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-cli-retired-delegates-'));
  try {
    writeDelegateFixture(sourceDir);
    for (const name of ['save-delegate-policy-draft', 'activate-delegate-policy']) {
      fs.unlinkSync(path.join(sourceDir, 'internal', 'cli', `promoted_${name}.go`));
    }
    assert.doesNotThrow(() => patchCliDelegateContracts(sourceDir));
  } finally {
    fs.rmSync(sourceDir, { recursive: true, force: true });
  }
});

test('rejects changed numeric contracts in present Delegate commands', () => {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-cli-drift-delegates-'));
  try {
    writeDelegateFixture(sourceDir);
    const filePath = path.join(sourceDir, 'internal', 'cli', 'promoted_save-delegate-policy-draft.go');
    fs.writeFileSync(filePath, fs.readFileSync(filePath, 'utf8').replace('bodyExpectedRevision != 0', 'bodyExpectedRevision > 0'));
    assert.throws(() => patchCliDelegateContracts(sourceDir), /required numeric body presence/);
  } finally {
    fs.rmSync(sourceDir, { recursive: true, force: true });
  }
});

// rtgit #2535: the generation stage exempts workspace plugin set/reset from
// automatic replay first; the Delegate exemption must extend that policy.
test('keeps both no-replay exemptions when workspace plugin commands exist', () => {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-cli-no-replay-'));
  try {
    writeDelegateFixture(sourceDir);
    patchWorkspacePluginClient(sourceDir);
    patchCliDelegateContracts(sourceDir);

    const client = fs.readFileSync(
      path.join(sourceDir, 'internal', 'client', 'client.go'),
      'utf8'
    );
    assert.match(client, /func isWorkspacePluginMutationPath/);
    assert.match(client, /func isDelegateMutationPath/);
    assert.equal(client.match(/\tmaxRetries := 3\n/g).length, 1);
    assert.match(client, /isDelegateMutationPath\(method, path\) \{\n\t\tmaxRetries = 0/);
    assert.match(client, /isWorkspacePluginMutationPath\(method, path\) \{\n\t\tmaxRetries = 0/);
    assert.doesNotMatch(client, /const maxRetries/);
  } finally {
    fs.rmSync(sourceDir, { recursive: true, force: true });
  }
});

test('patches generated Delegate mutation retry, numeric presence, and machine errors', () => {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-cli-delegates-'));
  try {
    writeDelegateFixture(sourceDir);
    patchCliDelegateContracts(sourceDir);

    const client = fs.readFileSync(
      path.join(sourceDir, 'internal', 'client', 'client.go'),
      'utf8'
    );
    const helpers = fs.readFileSync(
      path.join(sourceDir, 'internal', 'cli', 'helpers.go'),
      'utf8'
    );
    const saveDraft = fs.readFileSync(
      path.join(sourceDir, 'internal', 'cli', 'promoted_save-delegate-policy-draft.go'),
      'utf8'
    );
    const activate = fs.readFileSync(
      path.join(sourceDir, 'internal', 'cli', 'promoted_activate-delegate-policy.go'),
      'utf8'
    );

    assert.match(client, /func isDelegateMutationPath/);
    assert.match(client, /"\/activate-delegate-policy\/"/);
    assert.match(client, /maxRetries = 0/);
    assert.match(saveDraft, /Changed\("expected-revision"\)/);
    assert.match(saveDraft, /body\["expectedRevision"\] = bodyExpectedRevision/);
    assert.match(activate, /Changed\("expected-agent-config-revision"\)/);
    assert.match(activate, /Changed\("expected-authority-epoch"\)/);
    assert.match(activate, /Changed\("expected-draft-revision"\)/);
    assert.match(activate, /Use:\s+"activate-delegate-policy <instanceId> <candidateId>"/);
    assert.match(activate, /replacePathParam\(path, "candidateId", args\[1\]\)/);
    assert.doesNotMatch(activate, /flagCandidateId/);
    assert.match(helpers, /payload\["status"\] = apiErr\.StatusCode/);
    assert.match(helpers, /\[\]string\{"code", "details", "retry_after"\}/);
    assert.match(helpers, /payload\["retry_after"\] = apiErr\.RetryAfterSeconds/);
    assert.match(helpers, /writeAPIErrorEnvelope\(flags, classified, ExitCode\(classified\)\)/);
    // rtgit #3053: a 403 gets the auth hint only for a credential refusal.
    assert.match(helpers, /case isScopeForbidden\(forbiddenBody\):\n\t\t\tclassified = authErr/);
    assert.match(helpers, /case isAuthForbidden\(forbiddenBody\):\n\t\t\tclassified = authErr/);
    assert.match(helpers, /default:\n\t\t\tclassified = apiErr\(serverRefusal\(err, forbiddenPrefix, forbiddenBody\)\)/);
    assert.match(helpers, /The server asks to wait %d seconds \(retry_after\)/);
  } finally {
    fs.rmSync(sourceDir, { recursive: true, force: true });
  }
});

// rtgit #3053: the parts of the generated client.go that the Retry-After patch
// rewrites, as cli-printing-press 4.20.1 renders them.
function writeRetryFixture(sourceDir) {
  const clientDir = path.join(sourceDir, 'internal', 'client');
  const cliDir = path.join(sourceDir, 'internal', 'cli');
  fs.mkdirSync(clientDir, { recursive: true });
  fs.mkdirSync(cliDir, { recursive: true });
  fs.writeFileSync(
    path.join(clientDir, 'client.go'),
    `package client

import (
\t"context"
\t"fmt"
\t"math"
\t"net/http"
\t"os"
\t"strings"
\t"time"
)

type Client struct{}

// APIError carries HTTP status information for structured exit codes.
type APIError struct {
\tMethod     string
\tPath       string
\tStatusCode int
\tBody       string
}

func isMutatingVerb(method string) bool { return method == "POST" }

func (c *Client) doInternal(ctx context.Context, method, path string, params map[string]string, body any, headerOverrides map[string]string, readOnlyIntent bool) (json.RawMessage, int, error) {
\tconst maxRetries = 3
\tvar lastErr error

\tfor attempt := 0; attempt <= maxRetries; attempt++ {
\t\tvar resp *http.Response
\t\tvar respBody []byte
\t\tapiErr := &APIError{StatusCode: resp.StatusCode, Body: string(respBody)}

\t\t// Rate limited - adjust adaptive limiter and retry
\t\tif resp.StatusCode == 429 && attempt < maxRetries {
\t\t\tc.limiter.OnRateLimit()
\t\t\twait := cliutil.RetryAfter(resp)
\t\t\tfmt.Fprintf(os.Stderr, "rate limited, waiting %s (attempt %d/%d, rate adjusted to %.1f req/s)\\n", wait, attempt+1, maxRetries, c.limiter.Rate())
\t\t\tif err := sleepContext(ctx, wait); err != nil {
\t\t\t\treturn nil, 0, err
\t\t\t}
\t\t\tlastErr = apiErr
\t\t\tcontinue
\t\t}

\t\t// Server error - retry with backoff
\t\tif resp.StatusCode >= 500 && attempt < maxRetries {
\t\t\twait := time.Duration(math.Pow(2, float64(attempt))) * time.Second
\t\t\tif err := sleepContext(ctx, wait); err != nil {
\t\t\t\treturn nil, 0, err
\t\t\t}
\t\t\tlastErr = apiErr
\t\t\tcontinue
\t\t}

\t\treturn nil, resp.StatusCode, apiErr
\t}
\t_ = strings.TrimSpace(path)
\treturn nil, 0, lastErr
}
`
  );
}

test('waits for the server Retry-After on 429 within the bounds and keeps no-replay exemptions', () => {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-cli-retry-after-'));
  try {
    writeDelegateFixture(sourceDir);
    writeRetryFixture(sourceDir);
    patchWorkspacePluginClient(sourceDir);
    patchCliDelegateContracts(sourceDir);
    patchCliRetryAfterAndForbidden(sourceDir);

    const client = fs.readFileSync(path.join(sourceDir, 'internal', 'client', 'client.go'), 'utf8');
    assert.match(client, /RetryAfterSeconds int\n\}/);
    assert.match(client, /rateLimitRetries := 0\n\tvar rateLimitWaited time\.Duration\n\n\tfor attempt := 0;/);
    assert.match(client, /if resp\.StatusCode == 429 \{/);
    assert.match(client, /serverRetryAfter\(resp\.Header, respBody, time\.Now\(\)\)/);
    assert.match(client, /if retry && attempt < maxRetries \{/);
    // A wait outside the bounds fails at once instead of falling through.
    assert.match(client, /\t\t\treturn nil, resp\.StatusCode, apiErr\n\t\t\}\n\n\t\t\/\/ Server error/);
    assert.doesNotMatch(client, /cliutil\.RetryAfter\(resp\)/);
    assert.doesNotMatch(client, /resp\.StatusCode == 429 && attempt < maxRetries/);
    // Both "send once" exemptions still zero maxRetries, which also gates 429.
    assert.match(client, /isDelegateMutationPath\(method, path\) \{\n\t\tmaxRetries = 0/);
    assert.match(client, /isWorkspacePluginMutationPath\(method, path\) \{\n\t\tmaxRetries = 0/);
    // The 5xx backoff is unchanged.
    assert.match(client, /if resp\.StatusCode >= 500 && attempt < maxRetries \{/);

    const helper = fs.readFileSync(path.join(sourceDir, 'internal', 'client', RATE_LIMIT_HELPER_FILE), 'utf8');
    assert.match(helper, new RegExp(`rateLimitMaxWait\\s+= ${RATE_LIMIT_MAX_WAIT_SECONDS} \\* time\\.Second`));
    assert.match(helper, new RegExp(`rateLimitMaxRetries\\s+= ${RATE_LIMIT_MAX_RETRIES}\\n`));
    assert.match(helper, new RegExp(`rateLimitTotalWait\\s+= ${RATE_LIMIT_TOTAL_WAIT_SECONDS} \\* time\\.Second`));
    assert.ok(fs.existsSync(path.join(sourceDir, 'internal', 'cli', FORBIDDEN_HELPER_FILE)));
  } finally {
    fs.rmSync(sourceDir, { recursive: true, force: true });
  }
});

test('fails the build when the generated 429 retry changes', () => {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-cli-retry-drift-'));
  try {
    writeRetryFixture(sourceDir);
    const clientPath = path.join(sourceDir, 'internal', 'client', 'client.go');
    fs.writeFileSync(
      clientPath,
      fs.readFileSync(clientPath, 'utf8').replace('wait := cliutil.RetryAfter(resp)', 'wait := cliutil.Backoff(resp)')
    );
    assert.throws(() => patchCliRetryAfterAndForbidden(sourceDir), /Retry-After patch did not match[^\n]*429 retry/);
    assert.ok(!fs.existsSync(path.join(sourceDir, 'internal', 'client', RATE_LIMIT_HELPER_FILE)));
  } finally {
    fs.rmSync(sourceDir, { recursive: true, force: true });
  }
});

// The helpers decide the wait and the 403 kind; run them as Go.
test('generated Retry-After and 403 helpers behave as specified', () => {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-cli-retry-helpers-'));
  try {
    const clientDir = path.join(sourceDir, 'internal', 'client');
    const cliDir = path.join(sourceDir, 'internal', 'cli');
    fs.mkdirSync(clientDir, { recursive: true });
    fs.mkdirSync(cliDir, { recursive: true });
    fs.writeFileSync(path.join(clientDir, RATE_LIMIT_HELPER_FILE), RATE_LIMIT_HELPER_SOURCE);
    fs.writeFileSync(path.join(cliDir, FORBIDDEN_HELPER_FILE), FORBIDDEN_HELPER_SOURCE);
    fs.writeFileSync(
      path.join(clientDir, 'rate_limit_contract_test.go'),
      `package client

import (
\t"net/http"
\t"testing"
\t"time"
)

func TestServerRetryAfter(t *testing.T) {
\tnow := time.Date(2026, 11, 2, 12, 0, 0, 0, time.UTC)
\tcases := []struct {
\t\tname   string
\t\theader string
\t\tbody   string
\t\twant   time.Duration
\t\tok     bool
\t}{
\t\t{"header seconds", "2", \`{"retry_after":9}\`, 2 * time.Second, true},
\t\t{"header wins over body", "600", \`{"retry_after":1}\`, 600 * time.Second, true},
\t\t{"header http date", now.Add(30 * time.Second).Format(http.TimeFormat), "", 30 * time.Second, true},
\t\t{"body only", "", \`{"code":"CHANNEL_ACT_RATE_LIMITED","retry_after":3}\`, 3 * time.Second, true},
\t\t{"body string", "", \`{"retry_after":"4"}\`, 4 * time.Second, true},
\t\t{"bad header falls back to body", "soon", \`{"retry_after":5}\`, 5 * time.Second, true},
\t\t{"nothing", "", \`{"error":"slow down"}\`, 0, false},
\t\t{"not json", "", "Too Many Requests", 0, false},
\t}
\tfor _, tc := range cases {
\t\th := http.Header{}
\t\tif tc.header != "" {
\t\t\th.Set("Retry-After", tc.header)
\t\t}
\t\tgot, ok := serverRetryAfter(h, []byte(tc.body), now)
\t\tif got != tc.want || ok != tc.ok {
\t\t\tt.Errorf("%s: got %v %v, want %v %v", tc.name, got, ok, tc.want, tc.ok)
\t\t}
\t}
}

func TestRateLimitRetryWait(t *testing.T) {
\tif wait, retry := rateLimitRetryWait(2*time.Second, true, 0, 0); !retry || wait != 2*time.Second {
\t\tt.Errorf("2s first retry: got %v %v", wait, retry)
\t}
\tif _, retry := rateLimitRetryWait(60*time.Second, true, 0, 0); !retry {
\t\tt.Error("60s is within the one-wait bound")
\t}
\tif _, retry := rateLimitRetryWait(61*time.Second, true, 0, 0); retry {
\t\tt.Error("61s exceeds the one-wait bound and must fail at once")
\t}
\tif _, retry := rateLimitRetryWait(600*time.Second, true, 0, 0); retry {
\t\tt.Error("600s must fail at once")
\t}
\tif _, retry := rateLimitRetryWait(time.Second, true, 2, 2*time.Second); retry {
\t\tt.Error("no third retry")
\t}
\tif _, retry := rateLimitRetryWait(40*time.Second, true, 1, 60*time.Second); retry {
\t\tt.Error("60s+40s exceeds the 90s total bound")
\t}
\tif wait, retry := rateLimitRetryWait(0, false, 0, 0); !retry || wait != 5*time.Second {
\t\tt.Errorf("no server wait keeps the 5s default: got %v %v", wait, retry)
\t}
\tif got := retryAfterSeconds(1500 * time.Millisecond); got != 2 {
\t\tt.Errorf("retry_after rounds up: got %d", got)
\t}
}
`
    );
    fs.writeFileSync(
      path.join(cliDir, 'forbidden_contract_test.go'),
      `package cli

import (
\t"errors"
\t"testing"
)

func TestForbiddenKinds(t *testing.T) {
\tcases := []struct {
\t\tbody  string
\t\tauth  bool
\t\tscope bool
\t}{
\t\t// App server credential refusals (validApiKey.js).
\t\t{\`{"error":"No valid api key found."}\`, true, false},
\t\t{\`{"error":"No valid api key found.","code":"API_KEY_INVALID"}\`, true, false},
\t\t{\`{"error":"CLI credential does not authorize this operation.","code":"CLI_CREDENTIAL_SCOPE_FORBIDDEN","requiredScope":"channels:act"}\`, true, true},
\t\t{\`{"error":"This device is not permitted to use that endpoint","code":"DEVICE_ROUTE_NOT_PERMITTED"}\`, true, true},
\t\t{\`{"error":"Invalid terminal session token.","code":"TERMINAL_SESSION_TOKEN_INVALID"}\`, true, false},
\t\t// API refusals of this request.
\t\t{\`{"success":false,"error":"This account also serves other workspaces.","code":"CHANNEL_ACT_ISOLATED"}\`, false, false},
\t\t{\`{"success":false,"error":"That ref is not from this chat.","code":"CHANNEL_ACT_REF_NOT_OWN"}\`, false, false},
\t\t{\`{"success":false,"error":"Not available in this chat type.","code":"CHANNEL_ACT_CHAT_TYPE_UNSUPPORTED"}\`, false, false},
\t\t{\`{"success":false,"error":"Pass a valid token in the message ref.","code":"CHANNEL_ACT_REF_NOT_OWN"}\`, false, false},
\t\t{\`{"error":"Only the owner can do that."}\`, false, false},
\t\t{"<html>403 Forbidden</html>", false, false},
\t}
\tfor _, tc := range cases {
\t\tif got := isAuthForbidden(tc.body); got != tc.auth {
\t\t\tt.Errorf("isAuthForbidden(%s) = %v, want %v", tc.body, got, tc.auth)
\t\t}
\t\tif got := isScopeForbidden(tc.body); got != tc.scope {
\t\t\tt.Errorf("isScopeForbidden(%s) = %v, want %v", tc.body, got, tc.scope)
\t\t}
\t}
}

func TestServerRefusal(t *testing.T) {
\tbase := errors.New("raw")
\tgot := serverRefusal(base, "POST /channel-act/getFriendList returned HTTP 403", \`{"error":"Serves other workspaces.","code":"CHANNEL_ACT_ISOLATED"}\`)
\tif got.Error() != "POST /channel-act/getFriendList returned HTTP 403 CHANNEL_ACT_ISOLATED: Serves other workspaces." {
\t\tt.Errorf("message: %q", got.Error())
\t}
\tif !errors.Is(got, base) {
\t\tt.Error("the original error must stay reachable for the JSON envelope")
\t}
\tif serverRefusal(base, "", \`{"error":"x","code":"Y"}\`) != base {
\t\tt.Error("without a request line the error is unchanged")
\t}
\tif serverRefusal(base, "POST /x returned HTTP 403", "not json") != base {
\t\tt.Error("a body without an error text is unchanged")
\t}
}
`
    );
    execFileSync('go', ['mod', 'init', 'retry-after-contract'], { cwd: sourceDir, stdio: 'ignore' });
    execFileSync('go', ['test', './internal/client', './internal/cli'], {
      cwd: sourceDir,
      env: { ...process.env, CGO_ENABLED: '0' },
      stdio: 'pipe',
    });
  } finally {
    fs.rmSync(sourceDir, { recursive: true, force: true });
  }
});
