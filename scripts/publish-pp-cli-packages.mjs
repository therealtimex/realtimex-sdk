#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const REGISTRY = 'https://registry.npmjs.org';

function run(command, args, options = {}) {
  const printable = [command, ...args].join(' ');
  console.log(`$ ${printable}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${printable}`);
  }
}

function runResult(command, args, options = {}) {
  const printable = [command, ...args].join(' ');
  console.log(`$ ${printable}`);
  return spawnSync(command, args, {
    encoding: 'utf-8',
    shell: false,
    ...options,
  });
}

function readPackageJson(packageDir) {
  return JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf-8'));
}

function npmPreflight() {
  if (!process.env.NODE_AUTH_TOKEN && !process.env.NPM_TOKEN) {
    throw new Error('NODE_AUTH_TOKEN or NPM_TOKEN is required to publish npm packages.');
  }

  run('npm', ['whoami', '--registry', REGISTRY]);
}

export function publishPackage(packageDir, { execute = run, query = runResult } = {}) {
  const packageJson = readPackageJson(packageDir);
  const packageSpec = `${packageJson.name}@${packageJson.version}`;
  const existing = query('npm', ['view', packageSpec, 'version', '--json', '--registry', REGISTRY], { cwd: packageDir });
  if (existing.error) throw existing.error;
  let response;
  try { response = JSON.parse(existing.stdout || existing.stderr || 'null'); } catch { /* Fail closed below. */ }
  if (existing.status === 0) {
    if (response !== packageJson.version) throw new Error(`Unexpected registry version for ${packageSpec}`);
    console.log(`[publish] ${packageSpec} already exists; skipping`);
    return 'skipped';
  }
  const code = response?.error?.code;
  if (!['E404', 'ETARGET'].includes(code)) {
    throw new Error(`Registry lookup failed for ${packageSpec} (${code || existing.status}); not attempting publication`);
  }
  execute('npm', ['publish', '--access', 'public', '--registry', REGISTRY], { cwd: packageDir });
  return 'published';
}

export function publishRelease(root = REPO_ROOT, publish = publishPackage) {
  // Publish the independently versioned execution CLI before skills reference it.
  publish(path.join(root, 'rtxexec'));
  const packagesRoot = path.join(root, 'pp-cli', 'packages');
  for (const entry of fs.readdirSync(packagesRoot).sort()) {
    const packageDir = path.join(packagesRoot, entry);
    if (fs.existsSync(path.join(packageDir, 'package.json'))) publish(packageDir);
  }
  publish(path.join(root, 'pp-cli', 'main'));
  publish(path.join(root, 'typescript'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  npmPreflight();
  publishRelease();
}
