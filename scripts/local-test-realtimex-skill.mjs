#!/usr/bin/env node
/**
 * Build and install the local RealTimeX moderator skill for manual testing.
 *
 * Defaults:
 *   - builds realtimex-pp-cli for macOS amd64
 *   - symlinks it to /usr/local/bin/realtimex-pp-cli
 *   - regenerates typescript/skills/realtimex-moderator-sdk/SKILL.md
 *   - copies the skill into the test workspace .claude/skills directory
 *
 * Environment overrides:
 *   PP_CLI_GOOS=darwin
 *   PP_CLI_GOARCH=amd64
 *   PP_CLI_LINK_PATH=/usr/local/bin/realtimex-pp-cli
 *   REALTIMEX_APP_REPO=/Volumes/MAC-DATA/RTA/projects/realtimex-ai-app
 *   SKILL_DEST=/path/to/.claude/skills/realtimex-moderator-sdk
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_APP_REPO = path.resolve(REPO_ROOT, '..', 'realtimex-ai-app');
const APP_REPO = path.resolve(process.env.REALTIMEX_APP_REPO || DEFAULT_APP_REPO);
const APP_OPENAPI_PATH = path.join(APP_REPO, 'server', 'swagger', 'openapi.json');
const SDK_OPENAPI_PATH = path.join(REPO_ROOT, 'openapi.json');
const SKILL_NAME = 'realtimex-moderator-sdk';
const GOOS = process.env.PP_CLI_GOOS || 'darwin';
const GOARCH = process.env.PP_CLI_GOARCH || 'amd64';
const LINK_PATH =
  process.env.PP_CLI_LINK_PATH || '/usr/local/bin/realtimex-pp-cli';
const SKILL_OUT = path.join(REPO_ROOT, 'typescript', 'skills', SKILL_NAME);
const PP_OUTPUT_DIR =
  process.env.PP_CLI_SOURCE_DIR ||
  path.join(os.tmpdir(), `realtimex-local-test-pp-cli-${process.pid}`);
const SKILL_DEST =
  process.env.SKILL_DEST ||
  '/Users/rta/.realtimex.ai/desktop-user-data/dev/users/phuongnguyen_rtanalytics_vn/storage/working-data/test-workspace/.claude/skills/realtimex-moderator-sdk';

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

function rel(filePath) {
  return path.relative(REPO_ROOT, filePath) || '.';
}

function refreshOpenApiSpec() {
  if (!fs.existsSync(APP_OPENAPI_PATH)) {
    throw new Error(
      `App OpenAPI spec not found at ${APP_OPENAPI_PATH}. ` +
        'Set REALTIMEX_APP_REPO to the realtimex-ai-app repo path.'
    );
  }

  fs.copyFileSync(APP_OPENAPI_PATH, SDK_OPENAPI_PATH);
  console.log(
    `[local-test] copied ${APP_OPENAPI_PATH} -> ${rel(SDK_OPENAPI_PATH)}`
  );
}

function regenerateSkill() {
  run('node', [
    path.join(REPO_ROOT, 'scripts', 'generate-skill.mjs'),
    '--force',
    '--out',
    SKILL_OUT,
    '--printing-press-out',
    PP_OUTPUT_DIR,
  ]);
}

function rebuildSkillBinary() {
  const binaryPath = path.join(
    PP_OUTPUT_DIR,
    'build',
    'stage',
    'bin',
    GOOS === 'windows' ? 'realtimex-pp-cli.exe' : 'realtimex-pp-cli'
  );
  fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
  run('go', ['build', '-o', binaryPath, './cmd/realtimex-pp-cli'], {
    cwd: PP_OUTPUT_DIR,
    env: {
      ...process.env,
      GOOS,
      GOARCH,
      CGO_ENABLED: '0',
      GOCACHE:
        process.env.GOCACHE ||
        path.join(os.tmpdir(), 'realtimex-local-test-go-build-cache'),
    },
  });
  fs.chmodSync(binaryPath, 0o755);
  return binaryPath;
}

function installCliSymlink(binaryPath) {
  fs.mkdirSync(path.dirname(LINK_PATH), { recursive: true });
  fs.rmSync(LINK_PATH, { force: true });
  fs.symlinkSync(binaryPath, LINK_PATH);
  console.log(`[local-test] symlinked ${LINK_PATH} -> ${binaryPath}`);
}

function copySkill() {
  fs.rmSync(SKILL_DEST, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(SKILL_DEST), { recursive: true });
  fs.cpSync(SKILL_OUT, SKILL_DEST, { recursive: true });
  console.log(`[local-test] copied ${rel(SKILL_OUT)} -> ${SKILL_DEST}`);
}

function verify(binaryPath) {
  run(binaryPath, ['--version']);
  run(LINK_PATH, ['--version']);
}

function main() {
  console.log(`[local-test] repo: ${REPO_ROOT}`);
  console.log(`[local-test] app repo: ${APP_REPO}`);
  console.log(`[local-test] target: ${GOOS}/${GOARCH}`);
  console.log(`[local-test] skill out: ${SKILL_OUT}`);
  console.log(`[local-test] skill dest: ${SKILL_DEST}`);
  console.log(`[local-test] cli link: ${LINK_PATH}`);

  refreshOpenApiSpec();
  regenerateSkill();
  const binaryPath = rebuildSkillBinary();
  installCliSymlink(binaryPath);
  copySkill();
  verify(binaryPath);
  console.log('[local-test] done');
}

main();
