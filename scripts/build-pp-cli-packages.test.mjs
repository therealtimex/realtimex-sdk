import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  patchCliBaseURLPathJoin,
  patchCliCredentialReference,
  patchCliDelegateContracts,
  patchCliTerminalSessionAuth,
} from './build-pp-cli-packages.mjs';

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
    assert.match(helpers, /\[\]string\{"code", "details"\}/);
    assert.match(helpers, /writeAPIErrorEnvelope\(flags, classified, ExitCode\(classified\)\)/);
  } finally {
    fs.rmSync(sourceDir, { recursive: true, force: true });
  }
});
