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

for (const entry of fs.readdirSync(PACKAGES_ROOT).sort()) {
  const packageDir = path.join(PACKAGES_ROOT, entry);
  if (!fs.existsSync(path.join(packageDir, 'package.json'))) continue;
  run('npm', ['publish', '--access', 'public'], { cwd: packageDir });
}

run('npm', ['publish', '--access', 'public'], { cwd: MAIN_ROOT });
