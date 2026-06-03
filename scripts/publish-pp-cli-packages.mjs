#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PACKAGES_ROOT = path.join(REPO_ROOT, 'pp-cli', 'packages');
const MAIN_ROOT = path.join(REPO_ROOT, 'pp-cli', 'main');

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

  run('npm', ['whoami']);
}

npmPreflight();

function publishPackage(packageDir) {
  const packageJson = readPackageJson(packageDir);
  const packageSpec = `${packageJson.name}@${packageJson.version}`;
  const existing = runResult('npm', ['view', packageSpec, 'version'], {
    cwd: packageDir,
  });

  if (existing.status === 0 && existing.stdout.trim() === packageJson.version) {
    console.log(`[publish] ${packageSpec} already exists; skipping`);
    return;
  }

  run('npm', ['publish', '--access', 'public'], { cwd: packageDir });
}

for (const entry of fs.readdirSync(PACKAGES_ROOT).sort()) {
  const packageDir = path.join(PACKAGES_ROOT, entry);
  if (!fs.existsSync(path.join(packageDir, 'package.json'))) continue;
  publishPackage(packageDir);
}

publishPackage(MAIN_ROOT);
