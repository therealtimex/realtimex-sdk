import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  patchCliBaseURLPathJoin,
  patchCliCredentialReference,
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
