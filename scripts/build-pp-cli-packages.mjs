#!/usr/bin/env node
/**
 * Build npm packages for the generated realtimex-pp-cli binary.
 *
 * The package version is always read from typescript/package.json so
 * `npm view @realtimex/pp-cli version` and `realtimex-pp-cli --version` stay
 * aligned with the SDK package version.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SDK_PACKAGE = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'typescript', 'package.json'), 'utf-8')
);

const VERSION = SDK_PACKAGE.version;
const CLI_NAME = 'realtimex-pp-cli';
const MAIN_PACKAGE_NAME = '@realtimex/pp-cli';
const OUT_ROOT = path.join(REPO_ROOT, 'pp-cli');
const SOURCE_DIR =
  process.env.PP_CLI_SOURCE_DIR ||
  path.join(os.tmpdir(), `realtimex-pp-cli-source-${process.pid}`);

const TARGETS = [
  { goos: 'darwin', goarch: 'amd64', npmOs: 'darwin', npmCpu: 'x64' },
  { goos: 'darwin', goarch: 'arm64', npmOs: 'darwin', npmCpu: 'arm64' },
  { goos: 'linux', goarch: 'amd64', npmOs: 'linux', npmCpu: 'x64' },
  { goos: 'linux', goarch: 'arm64', npmOs: 'linux', npmCpu: 'arm64' },
  { goos: 'windows', goarch: 'amd64', npmOs: 'win32', npmCpu: 'x64' },
  { goos: 'windows', goarch: 'arm64', npmOs: 'win32', npmCpu: 'arm64' },
];

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

function copyDir(source, destination) {
  fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(source, destination, { recursive: true });
}

function patchCliVersion(sourceDir) {
  const rootGo = path.join(sourceDir, 'internal', 'cli', 'root.go');
  const contents = fs.readFileSync(rootGo, 'utf-8');
  const patched = contents.replace(
    /var version = ".*?"/,
    `var version = "${VERSION}"`
  );
  fs.writeFileSync(rootGo, patched);
}

function ensureSourceProject() {
  run('node', [
    path.join(REPO_ROOT, 'scripts', 'generate-skill.mjs'),
    '--force',
    '--out',
    path.join(os.tmpdir(), `realtimex-pp-cli-skill-${process.pid}`),
    '--printing-press-out',
    SOURCE_DIR,
  ]);
  patchCliVersion(SOURCE_DIR);
}

function packageName(target) {
  return `${MAIN_PACKAGE_NAME}-${target.npmOs}-${target.npmCpu}`;
}

function binaryName(target) {
  return target.goos === 'windows' ? `${CLI_NAME}.exe` : CLI_NAME;
}

function buildTarget(target) {
  const packageDir = path.join(OUT_ROOT, 'packages', `${target.npmOs}-${target.npmCpu}`);
  const binDir = path.join(packageDir, 'bin');
  fs.rmSync(packageDir, { recursive: true, force: true });
  fs.mkdirSync(binDir, { recursive: true });

  const binaryPath = path.join(binDir, binaryName(target));
  run('go', ['build', '-o', binaryPath, './cmd/realtimex-pp-cli'], {
    cwd: SOURCE_DIR,
    env: {
      ...process.env,
      GOOS: target.goos,
      GOARCH: target.goarch,
      CGO_ENABLED: '0',
      GOCACHE:
        process.env.GOCACHE ||
        path.join(os.tmpdir(), 'realtimex-pp-cli-go-build-cache'),
    },
  });

  fs.chmodSync(binaryPath, 0o755);
  fs.writeFileSync(
    path.join(packageDir, 'package.json'),
    `${JSON.stringify(
      {
        name: packageName(target),
        version: VERSION,
        description: `Platform binary for ${MAIN_PACKAGE_NAME} (${target.npmOs}/${target.npmCpu})`,
        license: 'MIT',
        os: [target.npmOs],
        cpu: [target.npmCpu],
        files: ['bin'],
        publishConfig: {
          access: 'public',
        },
      },
      null,
      2
    )}\n`
  );
  fs.writeFileSync(
    path.join(packageDir, 'README.md'),
    `# ${packageName(target)}\n\nPlatform binary package for \`${MAIN_PACKAGE_NAME}\`.\n`
  );
}

function writeMainPackage() {
  const mainDir = path.join(OUT_ROOT, 'main');
  fs.rmSync(mainDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(mainDir, 'bin'), { recursive: true });

  const optionalDependencies = {};
  for (const target of TARGETS) {
    optionalDependencies[packageName(target)] = VERSION;
  }

  fs.writeFileSync(
    path.join(mainDir, 'package.json'),
    `${JSON.stringify(
      {
        name: MAIN_PACKAGE_NAME,
        version: VERSION,
        description: 'RealtimeX Printing Press CLI',
        license: 'MIT',
        bin: {
          [CLI_NAME]: './bin/realtimex-pp-cli.js',
        },
        files: ['bin', 'README.md'],
        optionalDependencies,
        publishConfig: {
          access: 'public',
        },
      },
      null,
      2
    )}\n`
  );

  fs.writeFileSync(
    path.join(mainDir, 'bin', 'realtimex-pp-cli.js'),
    `#!/usr/bin/env node
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const packageName = '@realtimex/pp-cli-' + process.platform + '-' + process.arch;
const binaryName = process.platform === 'win32' ? 'realtimex-pp-cli.exe' : 'realtimex-pp-cli';

let binaryPath;
try {
  binaryPath = path.join(path.dirname(require.resolve(packageName + '/package.json')), 'bin', binaryName);
} catch (error) {
  const localPackagePath = path.resolve(__dirname, '..', '..', 'packages', process.platform + '-' + process.arch, 'package.json');
  if (fs.existsSync(localPackagePath)) {
    binaryPath = path.join(path.dirname(localPackagePath), 'bin', binaryName);
  } else {
    console.error('Unsupported platform for @realtimex/pp-cli: ' + process.platform + '/' + process.arch);
    console.error('Expected optional package: ' + packageName);
    process.exit(1);
  }
}

const result = spawnSync(binaryPath, process.argv.slice(2), { stdio: 'inherit' });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status == null ? 1 : result.status);
`
  );
  fs.chmodSync(path.join(mainDir, 'bin', 'realtimex-pp-cli.js'), 0o755);

  fs.writeFileSync(
    path.join(mainDir, 'README.md'),
    `# @realtimex/pp-cli\n\nInstall the RealtimeX Printing Press CLI.\n\n\`\`\`bash\nnpm install -g @realtimex/pp-cli\nrealtimex-pp-cli --version\n\`\`\`\n`
  );
}

function main() {
  console.log(`[pp-cli] SDK version: ${VERSION}`);
  console.log(`[pp-cli] output: ${OUT_ROOT}`);
  ensureSourceProject();
  fs.rmSync(OUT_ROOT, { recursive: true, force: true });
  fs.mkdirSync(OUT_ROOT, { recursive: true });
  for (const target of TARGETS) buildTarget(target);
  writeMainPackage();
  console.log('[pp-cli] packages ready');
}

main();
