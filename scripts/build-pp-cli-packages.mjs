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
const DEFAULT_CLI_TIMEOUT = process.env.PP_CLI_DEFAULT_TIMEOUT || '5*time.Minute';
const GO_KEYRING_PACKAGE = 'github.com/zalando/go-keyring@v0.2.8';

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

function replaceInFile(filePath, pattern, replacement) {
  if (!fs.existsSync(filePath)) return false;
  const contents = fs.readFileSync(filePath, 'utf-8');
  if (!pattern.test(contents)) return false;
  pattern.lastIndex = 0;
  const patched = contents.replace(pattern, replacement);
  if (patched !== contents) {
    fs.writeFileSync(filePath, patched);
  }
  return true;
}

function patchCliVersion(sourceDir) {
  const versionPatched = [
    path.join(sourceDir, 'internal', 'cli', 'version.go'),
    path.join(sourceDir, 'internal', 'cli', 'root.go'),
  ].some((filePath) =>
    replaceInFile(filePath, /var version = ".*?"/, `var version = "${VERSION}"`)
  );

  if (!versionPatched) {
    throw new Error('Generated CLI version variable not found; cannot pin realtimex-pp-cli version.');
  }

  replaceInFile(
    path.join(sourceDir, 'internal', 'client', 'client.go'),
    /(req\.Header\.Set\("User-Agent",\s*)"realtimex-pp-cli\/[^"]+"/,
    `$1"${CLI_NAME}/${VERSION}"`
  );
}

function patchCliDefaults(sourceDir) {
  const rootGo = path.join(sourceDir, 'internal', 'cli', 'root.go');
  const contents = fs.readFileSync(rootGo, 'utf-8');
  const patched = contents.replace(
    /DurationVar\(&flags\.timeout, "timeout", [^,]+, "Request timeout"\)/,
    `DurationVar(&flags.timeout, "timeout", ${DEFAULT_CLI_TIMEOUT}, "Request timeout")`
  );
  fs.writeFileSync(rootGo, patched);
}

function patchCliTerminalSessionAuth(sourceDir) {
  const configPath = path.join(sourceDir, 'internal', 'config', 'config.go');
  const clientPath = path.join(sourceDir, 'internal', 'client', 'client.go');
  const terminalConfigPatched = replaceInFile(
    configPath,
    /(\tRealtimexAppIdAuth string\s+`toml:"app_id_auth"`\n)/,
    `$1\tRealtimexTerminalSessionToken string            \`toml:"-"\`\n`
  );
  const terminalEnvPatched = replaceInFile(
    configPath,
    /\tif v := os\.Getenv\("REALTIMEX_APP_ID_AUTH"\); v != "" \{\n\t\tcfg\.RealtimexAppIdAuth = v\n\t\tcfg\.AuthSource = "env:REALTIMEX_APP_ID_AUTH"\n\t\}/,
    `\tif v := os.Getenv("REALTIMEX_TERMINAL_SESSION_TOKEN"); v != "" {\n\t\tcfg.RealtimexTerminalSessionToken = v\n\t\tcfg.AuthSource = "env:REALTIMEX_TERMINAL_SESSION_TOKEN"\n\t} else if v := os.Getenv("REALTIMEX_APP_ID_AUTH"); v != "" {\n\t\tcfg.RealtimexAppIdAuth = v\n\t\tcfg.AuthSource = "env:REALTIMEX_APP_ID_AUTH"\n\t}`
  );
  const terminalAuthMethodPatched = replaceInFile(
    configPath,
    /func \(c \*Config\) AuthHeader\(\) string \{\n/,
    `func (c *Config) UsesTerminalSessionToken() bool {\n\treturn c != nil && c.RealtimexTerminalSessionToken != ""\n}\n\nfunc (c *Config) AuthHeader() string {\n\tif c.UsesTerminalSessionToken() {\n\t\treturn c.RealtimexTerminalSessionToken\n\t}\n`
  );
  const requestAuthPatched = replaceInFile(
    clientPath,
    /\t\tif authHeader != "" \{\n\t\t\treq\.Header\.Set\("x-app-id", authHeader\)\n\t\t\}/,
    `\t\tif authHeader != "" {\n\t\t\tif c.Config.UsesTerminalSessionToken() {\n\t\t\t\treq.Header.Set("Authorization", "RealtimeX-Terminal "+authHeader)\n\t\t\t} else {\n\t\t\t\treq.Header.Set("x-app-id", authHeader)\n\t\t\t}\n\t\t}`
  );
  const redirectAuthPatched = replaceInFile(
    clientPath,
    /\t\t\tif h, err := c\.authHeader\(req\.Context\(\)\); err == nil && h != "" \{\n\t\t\t\treq\.Header\.Set\("x-app-id", h\)\n\t\t\t\}/,
    `\t\t\tif h, err := c.authHeader(req.Context()); err == nil && h != "" {\n\t\t\t\tif c.Config.UsesTerminalSessionToken() {\n\t\t\t\t\treq.Header.Set("Authorization", "RealtimeX-Terminal "+h)\n\t\t\t\t} else {\n\t\t\t\t\treq.Header.Set("x-app-id", h)\n\t\t\t\t}\n\t\t\t}`
  );
  const redirectStripPatched = replaceInFile(
    clientPath,
    /\t\t\treq\.Header\.Del\("x-app-id"\)/,
    `\t\t\treq.Header.Del("x-app-id")\n\t\t\treq.Header.Del("Authorization")`
  );
  const credentialMaskPatched = replaceInFile(
    clientPath,
    /\t\taddCredential\(c\.Config\.RealtimexAppIdAuth\)\n/,
    `\t\taddCredential(c.Config.RealtimexAppIdAuth)\n\t\taddCredential(c.Config.RealtimexTerminalSessionToken)\n`
  );
  const dryRunAuthPatched = replaceInFile(
    clientPath,
    /\tif authHeader != "" \{\n\t\tfmt\.Fprintf\(os\.Stderr, "  %s: %s\\n", "x-app-id", maskToken\(authHeader\)\)\n\t\}/,
    `\tif authHeader != "" {\n\t\theaderName := "x-app-id"\n\t\theaderValue := authHeader\n\t\tif c.Config.UsesTerminalSessionToken() {\n\t\t\theaderName = "Authorization"\n\t\t\theaderValue = "RealtimeX-Terminal " + authHeader\n\t\t}\n\t\tfmt.Fprintf(os.Stderr, "  %s: %s\\n", headerName, maskToken(headerValue))\n\t}`
  );

  if (
    !terminalConfigPatched ||
    !terminalEnvPatched ||
    !terminalAuthMethodPatched ||
    !requestAuthPatched ||
    !redirectAuthPatched ||
    !redirectStripPatched ||
    !credentialMaskPatched ||
    !dryRunAuthPatched
  ) {
    throw new Error(
      'Generated CLI terminal-session authentication patch did not match the Printing Press output.'
    );
  }

  run('gofmt', ['-w', configPath, clientPath]);
}

function patchCliCredentialReference(sourceDir) {
  const configPath = path.join(sourceDir, 'internal', 'config', 'config.go');
  const clientPath = path.join(sourceDir, 'internal', 'client', 'client.go');
  const rootPath = path.join(sourceDir, 'internal', 'cli', 'root.go');
  const keyringImportPatched = replaceInFile(
    configPath,
    /(import \(\n)/,
    `$1\tkeyring "github.com/zalando/go-keyring"\n`
  );
  const configPatched = replaceInFile(
    configPath,
    /(\tRealtimexTerminalSessionToken string\s+`toml:"-"`\n)/,
    `$1\tCliCredentialReference string            \`toml:"-"\`\n\tCliCredentialSecret    string            \`toml:"-"\`\n`
  );
  const methodsPatched = replaceInFile(
    configPath,
    /func \(c \*Config\) UsesTerminalSessionToken\(\) bool \{/,
    `func (c *Config) UseCredentialReference(reference string) error {
\treference = strings.TrimSpace(reference)
\tif !strings.HasPrefix(reference, "rtxcli_") {
\t\treturn fmt.Errorf("invalid CLI credential reference")
\t}
\tsecret, err := keyring.Get("ai.realtimex.cli.credentials", reference)
\tif err != nil {
\t\treturn fmt.Errorf("resolving CLI credential reference %s from the operating-system keychain: %w", reference, err)
\t}
\tif secret == "" {
\t\treturn fmt.Errorf("CLI credential reference %s resolved to an empty secret", reference)
\t}
\tc.CliCredentialReference = reference
\tc.CliCredentialSecret = secret
\tc.RealtimexTerminalSessionToken = ""
\tc.RealtimexAppIdAuth = ""
\tc.AuthHeaderVal = ""
\tc.AccessToken = ""
\tc.AuthSource = "keychain"
\treturn nil
}

func (c *Config) UsesCredentialReference() bool {
\treturn c != nil && c.CliCredentialReference != "" && c.CliCredentialSecret != ""
}

func (c *Config) UsesTerminalSessionToken() bool {`
  );
  const authMethodPatched = replaceInFile(
    configPath,
    /func \(c \*Config\) AuthHeader\(\) string \{\n/,
    `func (c *Config) AuthHeader() string {
\tif c.UsesCredentialReference() {
\t\treturn c.CliCredentialSecret
\t}
`
  );
  const flagFieldPatched = replaceInFile(
    rootPath,
    /(\tconfigPath\s+string\n)/,
    `$1\tcredentialRef       string\n`
  );
  const flagPatched = replaceInFile(
    rootPath,
    /(\trootCmd\.PersistentFlags\(\)\.StringVar\(&flags\.configPath, "config", "", "Config file path"\)\n)/,
    `$1\trootCmd.PersistentFlags().StringVar(&flags.credentialRef, "credential-ref", "", "Resolve a scoped CLI credential from the operating-system keychain")\n`
  );
  const loadPatched = replaceInFile(
    rootPath,
    /(\tcfg, err := config\.Load\(f\.configPath\)\n\tif err != nil \{\n\t\treturn nil, configErr\(err\)\n\t\}\n)/,
    `$1\tif f.credentialRef != "" {
\t\tif err := cfg.UseCredentialReference(f.credentialRef); err != nil {
\t\t\treturn nil, configErr(err)
\t\t}
\t}
`
  );
  const requestAuthPatched = replaceInFile(
    clientPath,
    /\t+if c\.Config\.UsesTerminalSessionToken\(\) \{\n\t+req\.Header\.Set\("Authorization", "RealtimeX-Terminal "\+authHeader\)\n\t+\} else \{\n\t+req\.Header\.Set\("x-app-id", authHeader\)\n\t+\}/,
    `\t\t\tif c.Config.UsesCredentialReference() {
\t\t\t\treq.Header.Set("Authorization", "Bearer "+authHeader)
\t\t\t} else if c.Config.UsesTerminalSessionToken() {
\t\t\t\treq.Header.Set("Authorization", "RealtimeX-Terminal "+authHeader)
\t\t\t} else {
\t\t\t\treq.Header.Set("x-app-id", authHeader)
\t\t\t}`
  );
  const redirectAuthPatched = replaceInFile(
    clientPath,
    /\t+if c\.Config\.UsesTerminalSessionToken\(\) \{\n\t+req\.Header\.Set\("Authorization", "RealtimeX-Terminal "\+h\)\n\t+\} else \{\n\t+req\.Header\.Set\("x-app-id", h\)\n\t+\}/,
    `\t\t\t\tif c.Config.UsesCredentialReference() {
\t\t\t\t\treq.Header.Set("Authorization", "Bearer "+h)
\t\t\t\t} else if c.Config.UsesTerminalSessionToken() {
\t\t\t\t\treq.Header.Set("Authorization", "RealtimeX-Terminal "+h)
\t\t\t\t} else {
\t\t\t\t\treq.Header.Set("x-app-id", h)
\t\t\t\t}`
  );
  const maskSecretPatched = replaceInFile(
    clientPath,
    /(\t+addCredential\(c\.Config\.RealtimexTerminalSessionToken\)\n)/,
    `$1\t\taddCredential(c.Config.CliCredentialSecret)\n`
  );
  const dryRunPatched = replaceInFile(
    clientPath,
    /\t\tif c\.Config\.UsesTerminalSessionToken\(\) \{\n\t\t\theaderName = "Authorization"\n\t\t\theaderValue = "RealtimeX-Terminal " \+ authHeader\n\t\t\}/,
    `\t\tif c.Config.UsesCredentialReference() {
\t\t\theaderName = "Authorization"
\t\t\theaderValue = "Bearer " + authHeader
\t\t} else if c.Config.UsesTerminalSessionToken() {
\t\t\theaderName = "Authorization"
\t\t\theaderValue = "RealtimeX-Terminal " + authHeader
\t\t}`
  );

  if (
    !keyringImportPatched ||
    !configPatched ||
    !methodsPatched ||
    !authMethodPatched ||
    !flagFieldPatched ||
    !flagPatched ||
    !loadPatched ||
    !requestAuthPatched ||
    !redirectAuthPatched ||
    !maskSecretPatched ||
    !dryRunPatched
  ) {
    const missed = [
      [keyringImportPatched, 'keyring import'],
      [configPatched, 'config fields'],
      [methodsPatched, 'config methods'],
      [authMethodPatched, 'auth method'],
      [flagFieldPatched, 'flag field'],
      [flagPatched, 'flag registration'],
      [loadPatched, 'config load'],
      [requestAuthPatched, 'request auth'],
      [redirectAuthPatched, 'redirect auth'],
      [maskSecretPatched, 'credential masking'],
      [dryRunPatched, 'dry-run masking'],
    ]
      .filter(([matched]) => !matched)
      .map(([, label]) => label)
      .join(', ');
    throw new Error(
      `Generated CLI credential-reference patch did not match the Printing Press output: ${missed}.`
    );
  }

  run('gofmt', ['-w', configPath, clientPath, rootPath]);
}

function patchCliBaseURLPathJoin(sourceDir) {
  const clientPath = path.join(sourceDir, 'internal', 'client', 'client.go');
  const baseURLPathJoinPatched = replaceInFile(
    clientPath,
    /(\thttpClient := newHTTPClient\(timeout, nil\)\n)\tc := &Client\{\n\t\tBaseURL:\s+strings\.TrimRight\(cfg\.BaseURL, "\/"\),\n\t\tBasePath:\s+normalizeBasePath\(cfg\.BasePath\),\n/,
    `$1\tbaseURL := strings.TrimRight(cfg.BaseURL, "/")
\tbasePath := normalizeBasePath(cfg.BasePath)
\tif basePath != "" && strings.HasSuffix(baseURL, basePath) {
\t\tbasePath = ""
\t}
\tc := &Client{
\t\tBaseURL:  baseURL,
\t\tBasePath: basePath,
`
  );
  if (!baseURLPathJoinPatched) {
    throw new Error(
      'Generated CLI base URL path join patch did not match the Printing Press output.'
    );
  }
  run('gofmt', ['-w', clientPath]);
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
  patchCliDefaults(SOURCE_DIR);
  patchCliTerminalSessionAuth(SOURCE_DIR);
  patchCliCredentialReference(SOURCE_DIR);
  patchCliBaseURLPathJoin(SOURCE_DIR);
  run('go', ['get', GO_KEYRING_PACKAGE], { cwd: SOURCE_DIR });
  run('go', ['mod', 'tidy'], { cwd: SOURCE_DIR });
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
  run('go', [
    'build',
    '-ldflags',
    `-X realtimex-pp-cli/internal/cli.version=${VERSION}`,
    '-o',
    binaryPath,
    './cmd/realtimex-pp-cli',
  ], {
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

const MAIN_PACKAGE_NAME = '@realtimex/pp-cli';
const MODERATOR_PLUGIN_ID = 'com.realtimex.moderator-sdk';
const SDK_PACKAGE_NAME = '@realtimex/sdk';
const SDK_PACKAGE_PATH_PARTS = [
  'plugin-data',
  MODERATOR_PLUGIN_ID,
  'node_modules',
  '@realtimex',
  'sdk',
  'package.json',
];
const packageName = '@realtimex/pp-cli-' + process.platform + '-' + process.arch;
const binaryName = process.platform === 'win32' ? 'realtimex-pp-cli.exe' : 'realtimex-pp-cli';

function readPackageVersion(packageJsonPath) {
  try {
    return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')).version || null;
  } catch (_) {
    return null;
  }
}

function installedCliVersion() {
  try {
    const packageJsonPath = path.resolve(__dirname, '..', 'package.json');
    return readPackageVersion(packageJsonPath);
  } catch (_) {
    return null;
  }
}

function moderatorSdkPackageJsonPath() {
  const storageDir = String(process.env.STORAGE_DIR || '').trim();
  if (!storageDir) return null;
  return path.join(storageDir, ...SDK_PACKAGE_PATH_PARTS);
}

function installCliVersion(version) {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(
    npmCommand,
    ['install', '-g', MAIN_PACKAGE_NAME + '@' + version],
    { stdio: 'inherit' }
  );
  if (result.error) {
    console.error('warning: failed to update ' + MAIN_PACKAGE_NAME + ': ' + result.error.message);
    return false;
  }
  if (result.status !== 0) {
    console.error(
      'warning: failed to update ' +
        MAIN_PACKAGE_NAME +
        ' to ' +
        version +
        ' (npm exited ' +
        (result.status == null ? 'unknown' : result.status) +
        '); continuing with the current CLI.'
    );
    return false;
  }
  const updatedVersion = installedCliVersion();
  if (updatedVersion !== version) {
    console.error(
      'warning: updated ' +
        MAIN_PACKAGE_NAME +
        ', but installed version is still ' +
        (updatedVersion || 'unknown') +
        ' instead of ' +
        version +
        '; continuing with the current CLI.'
    );
    return false;
  }
  return true;
}

function ensureCliVersionMatchesModeratorSdk() {
  if (process.env.REALTIMEX_PP_CLI_PLUGIN_UPDATE_CHECK === '0') return;
  const sdkPackageJsonPath = moderatorSdkPackageJsonPath();
  if (!sdkPackageJsonPath || !fs.existsSync(sdkPackageJsonPath)) return;

  const sdkVersion = readPackageVersion(sdkPackageJsonPath);
  const cliVersion = installedCliVersion();
  if (!sdkVersion || !cliVersion || sdkVersion === cliVersion) return;

  console.error(
    'Updating ' +
      MAIN_PACKAGE_NAME +
      ' from ' +
      cliVersion +
      ' to ' +
      sdkVersion +
      ' to match ' +
      SDK_PACKAGE_NAME +
      ' in plugin data.'
  );
  if (!installCliVersion(sdkVersion)) return;
  const rerun = spawnSync(process.execPath, [process.argv[1], ...process.argv.slice(2)], {
    stdio: 'inherit',
  });
  if (rerun.error) {
    console.error(rerun.error.message);
    process.exit(1);
  }
  process.exit(rerun.status == null ? 1 : rerun.status);
}

ensureCliVersionMatchesModeratorSdk();

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

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}

export {
  patchCliBaseURLPathJoin,
  patchCliCredentialReference,
  patchCliTerminalSessionAuth,
};
