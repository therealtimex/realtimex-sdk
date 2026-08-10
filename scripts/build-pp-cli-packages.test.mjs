import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  patchCliBaseURLPathJoin,
  patchCliTerminalSessionAuth,
} from './build-pp-cli-packages.mjs';

function writeFixture(sourceDir) {
  const configDir = path.join(sourceDir, 'internal', 'config');
  const clientDir = path.join(sourceDir, 'internal', 'client');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(clientDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, 'config.go'),
    `package config

import "os"

type Config struct {
\tRealtimexAppIdAuth string \`toml:"app_id_auth"\`
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
\tBaseURL string
}

func (c *Client) target(path string) string {
\ttargetURL := c.BaseURL + path
\treturn targetURL
}
`
    );

    patchCliBaseURLPathJoin(sourceDir);

    const client = fs.readFileSync(
      path.join(clientDir, 'client.go'),
      'utf8'
    );
    assert.match(client, /strings\.HasSuffix\(c\.BaseURL, "\/cli"\)/);
    assert.match(client, /strings\.TrimPrefix\(path, "\/cli"\)/);
    assert.match(client, /targetURL := c\.BaseURL \+ requestPath/);
  } finally {
    fs.rmSync(sourceDir, { recursive: true, force: true });
  }
});
