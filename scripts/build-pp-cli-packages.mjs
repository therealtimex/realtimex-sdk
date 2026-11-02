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
    `$1\twincred "github.com/danieljoos/wincred"\n\tkeyring "github.com/zalando/go-keyring"\n\tsecretservice "github.com/zalando/go-keyring/secret_service"\n\t"runtime"\n`
  );
  const configPatched = replaceInFile(
    configPath,
    /(\tRealtimexTerminalSessionToken string\s+`toml:"-"`\n)/,
    `$1\tCliCredentialReference string            \`toml:"-"\`\n\tCliCredentialSecret    string            \`toml:"-"\`\n`
  );
  const methodsPatched = replaceInFile(
    configPath,
    /func \(c \*Config\) UsesTerminalSessionToken\(\) bool \{/,
    `func readCliCredential(service, reference string) (string, error) {
\tswitch runtime.GOOS {
\tcase "windows":
\t\tcredential, err := wincred.GetGenericCredential(service + "/" + reference)
\t\tif err != nil {
\t\t\treturn "", err
\t\t}
\t\treturn string(credential.CredentialBlob), nil
\tcase "linux":
\t\tsecretService, err := secretservice.NewSecretService()
\t\tif err != nil {
\t\t\treturn "", err
\t\t}
\t\tcollection := secretService.GetLoginCollection()
\t\tif err := secretService.Unlock(collection.Path()); err != nil {
\t\t\treturn "", err
\t\t}
\t\titems, err := secretService.SearchItems(collection, map[string]string{
\t\t\t"service": service,
\t\t\t"account": reference,
\t\t})
\t\tif err != nil {
\t\t\treturn "", err
\t\t}
\t\tif len(items) == 0 {
\t\t\treturn "", keyring.ErrNotFound
\t\t}
\t\tsession, err := secretService.OpenSession()
\t\tif err != nil {
\t\t\treturn "", err
\t\t}
\t\tdefer secretService.Close(session)
\t\tif err := secretService.Unlock(items[0]); err != nil {
\t\t\treturn "", err
\t\t}
\t\tsecret, err := secretService.GetSecret(items[0], session.Path())
\t\tif err != nil {
\t\t\treturn "", err
\t\t}
\t\treturn string(secret.Value), nil
\tdefault:
\t\treturn keyring.Get(service, reference)
\t}
}

func (c *Config) UseCredentialReference(reference string) error {
\treference = strings.TrimSpace(reference)
\tif !strings.HasPrefix(reference, "rtxcli_") {
\t\treturn fmt.Errorf("invalid CLI credential reference")
\t}
\tsecret, err := readCliCredential("ai.realtimex.cli.credentials", reference)
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
  const clientContents = fs.readFileSync(clientPath, 'utf-8');
  if (!clientContents.includes('BasePath')) {
    return;
  }
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

function patchCliDelegateContracts(sourceDir) {
  const clientPath = path.join(sourceDir, 'internal', 'client', 'client.go');
  const helpersPath = path.join(sourceDir, 'internal', 'cli', 'helpers.go');
  const saveDraftPath = path.join(
    sourceDir,
    'internal',
    'cli',
    'promoted_save-delegate-policy-draft.go'
  );
  const activatePath = path.join(
    sourceDir,
    'internal',
    'cli',
    'promoted_activate-delegate-policy.go'
  );

  const predicatePatched = replaceInFile(
    clientPath,
    /(func \(c \*Client\) doInternal\(ctx context\.Context, method, path string, params map\[string\]string, body any, headerOverrides map\[string\]string, readOnlyIntent bool\))(\s*(?:\(json\.RawMessage, int, error\))?\s*\{)/,
    `func isDelegateMutationPath(method, path string) bool {
\tif !isMutatingVerb(method) {
\t\treturn false
\t}
\tfor _, prefix := range []string{
\t\t"/provision-delegate",
\t\t"/save-delegate-policy-draft/",
\t\t"/compile-delegate-policy/",
\t\t"/cancel-delegate-compiler-job/",
\t\t"/retry-delegate-compiler-job/",
\t\t"/activate-delegate-policy/",
\t\t"/suspend-delegate/",
\t\t"/resume-delegate/",
\t\t"/revoke-delegate-outstanding/",
\t} {
\t\tif strings.HasPrefix(path, prefix) {
\t\t\treturn true
\t\t}
\t}
\treturn false
}

$1$2`
  );
  // The generation stage may already have made maxRetries a variable for
  // workspace plugin mutations (workspace-plugin-cli-contract.mjs); extend it.
  const retryPatched = replaceInFile(
    clientPath,
    /\t(?:const maxRetries = 3|maxRetries := 3)\n/,
    `\tmaxRetries := 3
\tif !readOnlyIntent && isDelegateMutationPath(method, path) {
\t\tmaxRetries = 0
\t}
`
  );

  function patchRequiredNumber(filePath, variable, flagName, bodyName) {
    // App specs can omit retired Delegate commands. Present commands must
    // still match the expected contract so generator drift fails the build.
    if (!fs.existsSync(filePath)) return true;
    return replaceInFile(
      filePath,
      new RegExp(
        `\\t\\t\\tif ${variable} != 0 \\{\\n\\t\\t\\t\\tbody\\["${bodyName}"\\] = ${variable}\\n\\t\\t\\t\\}`
      ),
      `\t\t\tif cmd.Flags().Changed("${flagName}") {
\t\t\t\tbody["${bodyName}"] = ${variable}
\t\t\t}`
    );
  }

  const requiredNumbersPatched = [
    patchRequiredNumber(
      saveDraftPath,
      'bodyExpectedRevision',
      'expected-revision',
      'expectedRevision'
    ),
    patchRequiredNumber(
      activatePath,
      'bodyExpectedAgentConfigRevision',
      'expected-agent-config-revision',
      'expectedAgentConfigRevision'
    ),
    patchRequiredNumber(
      activatePath,
      'bodyExpectedAuthorityEpoch',
      'expected-authority-epoch',
      'expectedAuthorityEpoch'
    ),
    patchRequiredNumber(
      activatePath,
      'bodyExpectedDraftRevision',
      'expected-draft-revision',
      'expectedDraftRevision'
    ),
  ].every(Boolean);

  function patchCandidatePathPosition(filePath, commandName) {
    if (!fs.existsSync(filePath)) return true;
    let contents = fs.readFileSync(filePath, 'utf-8');
    if (!contents.includes('flagCandidateId')) return true;
    const replacements = [
      [
        '\tvar flagCandidateId string\n',
        '',
      ],
      [
        `\t\tUse:         "${commandName} <instanceId>",`,
        `\t\tUse:         "${commandName} <instanceId> <candidateId>",`,
      ],
      [
        /\t\t\tif !cmd\.Flags\(\)\.Changed\("candidate-id"\) && !flags\.dryRun \{\n\t\t\t\treturn fmt\.Errorf\("required flag \\"%s\\" not set", "candidate-id"\)\n\t\t\t\}\n/,
        '',
      ],
      [
        '\t\t\tpath = replacePathParam(path, "candidateId", fmt.Sprintf("%v", flagCandidateId))',
        `\t\t\tif len(args) < 2 {
\t\t\t\tif flags.asJSON {
\t\t\t\t\tif printErr := printJSONFiltered(cmd.OutOrStdout(), map[string]any{
\t\t\t\t\t\t"error": "candidateId is required",
\t\t\t\t\t\t"usage": fmt.Sprintf("%s <%s> <%s>", cmd.CommandPath(), "instanceId", "candidateId"),
\t\t\t\t\t}, flags); printErr != nil {
\t\t\t\t\t\treturn printErr
\t\t\t\t\t}
\t\t\t\t}
\t\t\t\treturn usageErr(fmt.Errorf("candidateId is required\\nUsage: %s <%s> <%s>", cmd.CommandPath(), "instanceId", "candidateId"))
\t\t\t}
\t\t\tpath = replacePathParam(path, "candidateId", args[1])`,
      ],
      [
        '\tcmd.Flags().StringVar(&flagCandidateId, "candidate-id", "", "Candidate id")\n',
        '',
      ],
    ];
    for (const [pattern, replacement] of replacements) {
      if (
        typeof pattern === 'string'
          ? !contents.includes(pattern)
          : !pattern.test(contents)
      ) {
        return false;
      }
      if (pattern instanceof RegExp) pattern.lastIndex = 0;
      contents = contents.replace(pattern, replacement);
    }
    contents = contents.replace(
      / --candidate-id [^\s"]+/,
      ' candidate-id'
    );
    fs.writeFileSync(filePath, contents);
    return true;
  }

  const candidateCommands = [
    ['get-delegate-policy-candidate', 'get-delegate-policy-candidate'],
    ['simulate-delegate-policy', 'simulate-delegate-policy'],
    ['activate-delegate-policy', 'activate-delegate-policy'],
  ];
  const candidatePositionsPatched = candidateCommands.every(
    ([fileName, commandName]) =>
      patchCandidatePathPosition(
        path.join(sourceDir, 'internal', 'cli', `promoted_${fileName}.go`),
        commandName
      )
  );

  const errorEnvelopePatched = replaceInFile(
    helpersPath,
    /func writeAPIErrorEnvelope\(flags \*rootFlags, err error, code int\) \{[\s\S]*?\n\}\n\n\/\/ classifyAPIError/,
    `func writeAPIErrorEnvelope(flags *rootFlags, err error, exitCode int) {
\tif flags == nil || !flags.asJSON {
\t\treturn
\t}
\tpayload := map[string]any{
\t\t"error":     err.Error(),
\t\t"exit_code": exitCode,
\t}
\tvar apiErr *client.APIError
\tif errors.As(err, &apiErr) {
\t\tpayload["status"] = apiErr.StatusCode
\t\tpayload["method"] = apiErr.Method
\t\tpayload["path"] = apiErr.Path
\t\tvar body any
\t\tif json.Unmarshal([]byte(apiErr.Body), &body) == nil {
\t\t\tpayload["body"] = body
\t\t\tif object, ok := body.(map[string]any); ok {
\t\t\t\tfor _, key := range []string{"code", "details", "retry_after"} {
\t\t\t\t\tif value, exists := object[key]; exists {
\t\t\t\t\t\tpayload[key] = value
\t\t\t\t\t}
\t\t\t\t}
\t\t\t\tif value, exists := object["message"]; exists {
\t\t\t\t\tpayload["message"] = value
\t\t\t\t} else if value, exists := object["error"]; exists {
\t\t\t\t\tpayload["message"] = value
\t\t\t\t}
\t\t\t}
\t\t} else {
\t\t\tpayload["body"] = apiErr.Body
\t\t}
\t\t// The wait the server asked for (Retry-After header first), in seconds.
\t\tif apiErr.RetryAfterSeconds > 0 {
\t\t\tpayload["retry_after"] = apiErr.RetryAfterSeconds
\t\t}
\t}
\tif _, exists := payload["code"]; !exists {
\t\tpayload["code"] = exitCode
\t}
\t_ = json.NewEncoder(os.Stdout).Encode(payload)
}

// classifyAPIError`
  );

  const classifierPatched = replaceInFile(
    helpersPath,
    /func classifyAPIError\(err error, flags \*rootFlags\) error \{[\s\S]*?\n\}\n\n\/\/ classifyDeleteError/,
    `func classifyAPIError(err error, flags *rootFlags) error {
\tvar typed *cliError
\tif errors.As(err, &typed) {
\t\treturn err
\t}

\tmsg := err.Error()
\tvar classified error
\tswitch {
\tcase strings.Contains(msg, "HTTP 409"):
\t\tif flags != nil && flags.idempotent {
\t\t\treturn writeNoop(flags, "already_exists", "already exists (no-op)")
\t\t}
\t\tclassified = apiErr(err)
\tcase errors.Is(err, client.ErrPlaceholderCredential):
\t\tclassified = authErr(err)
\tcase strings.Contains(msg, "HTTP 400") && cliutil.LooksLikeAuthError(msg):
\t\tclassified = authErr(fmt.Errorf("%w\\nhint: the API rejected the request — this usually means auth is missing or invalid."+
\t\t\t"\\n      Set your API key: export REALTIMEX_APP_ID_AUTH=<your-key>"+
\t\t\t"\\n      Run 'realtimex-pp-cli doctor' to check auth status."+
\t\t\t"\\n      Response: "+cliutil.SanitizeErrorBody(msg), err))
\tcase strings.Contains(msg, "HTTP 401"):
\t\tclassified = authErr(fmt.Errorf("%w\\nhint: check your API key."+
\t\t\t" Set it with: export REALTIMEX_APP_ID_AUTH=<your-key>"+
\t\t\t"\\n      Run 'realtimex-pp-cli doctor' to check auth status.", err))
\tcase strings.Contains(msg, "HTTP 403"):
\t\t// Only the auth middleware's credential refusals get the auth hint and
\t\t// exit code; any other 403 is the API refusing this request (rtgit #3053).
\t\tforbiddenBody := msg
\t\tforbiddenPrefix := ""
\t\tvar forbidden *client.APIError
\t\tif errors.As(err, &forbidden) {
\t\t\tforbiddenBody = forbidden.Body
\t\t\tforbiddenPrefix = fmt.Sprintf("%s %s returned HTTP %d", forbidden.Method, forbidden.Path, forbidden.StatusCode)
\t\t}
\t\tswitch {
\t\tcase isScopeForbidden(forbiddenBody):
\t\t\tclassified = authErr(fmt.Errorf("%w\\nhint: permission denied. Your credentials are valid but lack access to this resource."+
\t\t\t\t"\\n      Check that your API key has the required permissions."+
\t\t\t\t"\\n      Set it with: export REALTIMEX_APP_ID_AUTH=<your-key>"+
\t\t\t\t"\\n      Run 'realtimex-pp-cli doctor' to check auth status.", err))
\t\tcase isAuthForbidden(forbiddenBody):
\t\t\tclassified = authErr(fmt.Errorf("%w\\nhint: the server did not accept your credentials. Check your API key."+
\t\t\t\t"\\n      Set it with: export REALTIMEX_APP_ID_AUTH=<your-key>"+
\t\t\t\t"\\n      Run 'realtimex-pp-cli doctor' to check auth status.", err))
\t\tdefault:
\t\t\tclassified = apiErr(serverRefusal(err, forbiddenPrefix, forbiddenBody))
\t\t}
\tcase strings.Contains(msg, "HTTP 404"):
\t\tclassified = notFoundErr(fmt.Errorf("%w\\nhint: resource not found. Run the 'list' command to see available items", err))
\tcase strings.Contains(msg, "HTTP 429"):
\t\tvar limited *client.APIError
\t\tif errors.As(err, &limited) && limited.RetryAfterSeconds > 0 {
\t\t\tclassified = rateLimitErr(fmt.Errorf("%w\\nhint: rate limited. The server asks to wait %d seconds (retry_after) before trying again.", err, limited.RetryAfterSeconds))
\t\t} else {
\t\t\tclassified = rateLimitErr(err)
\t\t}
\tdefault:
\t\tclassified = apiErr(err)
\t}
\twriteAPIErrorEnvelope(flags, classified, ExitCode(classified))
\treturn classified
}

// classifyDeleteError`
  );

  if (
    !predicatePatched ||
    !retryPatched ||
    !requiredNumbersPatched ||
    !candidatePositionsPatched ||
    !errorEnvelopePatched ||
    !classifierPatched
  ) {
    const missed = [
      [predicatePatched, 'Delegate mutation predicate'],
      [retryPatched, 'Delegate mutation retry limit'],
      [requiredNumbersPatched, 'required numeric body presence'],
      [candidatePositionsPatched, 'candidate path positional arguments'],
      [errorEnvelopePatched, 'machine error envelope'],
      [classifierPatched, 'machine error classification'],
    ]
      .filter(([matched]) => !matched)
      .map(([, label]) => label)
      .join(', ');
    throw new Error(
      `Generated CLI Delegate contract patch did not match the Printing Press output: ${missed}.`
    );
  }

  const gofmtPaths = [
    clientPath,
    helpersPath,
    saveDraftPath,
    ...candidateCommands.map(([fileName]) =>
      path.join(sourceDir, 'internal', 'cli', `promoted_${fileName}.go`)
    ),
  ].filter((filePath) => fs.existsSync(filePath));
  run('gofmt', ['-w', ...gofmtPaths]);
}

// rtgit #3053. The generated client answers an HTTP 429 with up to three
// retries, each after the Retry-After header capped at 60 s, or after a fixed
// 5 s guess when the server put the wait only in the body. A longer wait was
// cut short and replayed into the same limit, and a body-only retry_after was
// ignored, so the CLI gave up before the server's time. The patched loop waits
// exactly as long as the server asks (header first, then the body's
// retry_after), within the bounds below; a longer wait fails at once and the
// error carries retry_after so the agent can decide. Requests sent at most
// once (maxRetries == 0: Delegate mutations, workspace plugin set/reset) are
// still never replayed.
export const RATE_LIMIT_MAX_WAIT_SECONDS = 60;
export const RATE_LIMIT_MAX_RETRIES = 2;
export const RATE_LIMIT_TOTAL_WAIT_SECONDS = 90;

export const RATE_LIMIT_HELPER_FILE = 'rate_limit_contract.go';
export const RATE_LIMIT_HELPER_SOURCE = `// Added by realtimex-sdk scripts/build-pp-cli-packages.mjs (rtgit #3053).

package client

import (
\t"encoding/json"
\t"math"
\t"net/http"
\t"strconv"
\t"strings"
\t"time"
)

// A 429 is retried after the wait the server asks for: one wait of at most
// rateLimitMaxWait, at most rateLimitMaxRetries retries, and no more than
// rateLimitTotalWait in total, so a CLI call stays inside an agent's command
// timeout. A longer wait fails at once with retry_after.
const (
\trateLimitMaxWait     = ${RATE_LIMIT_MAX_WAIT_SECONDS} * time.Second
\trateLimitMaxRetries  = ${RATE_LIMIT_MAX_RETRIES}
\trateLimitTotalWait   = ${RATE_LIMIT_TOTAL_WAIT_SECONDS} * time.Second
\trateLimitDefaultWait = 5 * time.Second
\t// Larger values are treated as "not within any bound".
\trateLimitMaxSeconds = 365 * 24 * 60 * 60
)

func rateLimitSeconds(seconds float64) time.Duration {
\tif seconds > rateLimitMaxSeconds {
\t\tseconds = rateLimitMaxSeconds
\t}
\treturn time.Duration(seconds * float64(time.Second))
}

// serverRetryAfter reads how long the server asks to wait: the Retry-After
// header (seconds or an HTTP date), then the body's retry_after (seconds).
func serverRetryAfter(header http.Header, body []byte, now time.Time) (time.Duration, bool) {
\tif value := strings.TrimSpace(header.Get("Retry-After")); value != "" {
\t\tif seconds, err := strconv.ParseFloat(value, 64); err == nil && seconds >= 0 && !math.IsInf(seconds, 0) {
\t\t\treturn rateLimitSeconds(seconds), true
\t\t}
\t\tif at, err := http.ParseTime(value); err == nil {
\t\t\tif wait := at.Sub(now); wait > 0 {
\t\t\t\treturn wait, true
\t\t\t}
\t\t\treturn 0, true
\t\t}
\t}
\tvar payload map[string]any
\tif json.Unmarshal(body, &payload) == nil {
\t\tswitch value := payload["retry_after"].(type) {
\t\tcase float64:
\t\t\tif value >= 0 {
\t\t\t\treturn rateLimitSeconds(value), true
\t\t\t}
\t\tcase string:
\t\t\tif seconds, err := strconv.ParseFloat(strings.TrimSpace(value), 64); err == nil && seconds >= 0 && !math.IsInf(seconds, 0) {
\t\t\t\treturn rateLimitSeconds(seconds), true
\t\t\t}
\t\t}
\t}
\treturn 0, false
}

// rateLimitRetryWait decides one 429: the wait before the next attempt, and
// whether to retry at all given the retries and wait already spent.
func rateLimitRetryWait(wait time.Duration, fromServer bool, retries int, waited time.Duration) (time.Duration, bool) {
\tif !fromServer {
\t\twait = rateLimitDefaultWait
\t}
\tif retries >= rateLimitMaxRetries || wait > rateLimitMaxWait || waited+wait > rateLimitTotalWait {
\t\treturn wait, false
\t}
\treturn wait, true
}

// retryAfterSeconds is the wait in whole seconds, rounded up, for the error
// envelope's retry_after.
func retryAfterSeconds(wait time.Duration) int {
\tseconds := int(math.Ceil(wait.Seconds()))
\tif seconds < 1 {
\t\treturn 1
\t}
\treturn seconds
}
`;

export const FORBIDDEN_HELPER_FILE = 'forbidden_contract.go';
export const FORBIDDEN_HELPER_SOURCE = `// Added by realtimex-sdk scripts/build-pp-cli-packages.mjs (rtgit #3053).

package cli

import (
\t"encoding/json"
\t"fmt"
\t"regexp"
\t"strings"
)

// The 403 codes of the app server's credential checks
// (server/utils/middleware/validApiKey.js and the auth helpers it calls):
// API_KEY_INVALID, CLI_CREDENTIAL_* (expired, revoked, scope), TERMINAL_SESSION_*
// and the DEVICE_* route allowlist. Any other coded 403, such as
// CHANNEL_ACT_ISOLATED or CHANNEL_ACT_REF_NOT_OWN, is the API refusing this
// request, not a credential problem.
var authForbiddenCodePrefixes = []string{"API_KEY_", "CLI_CREDENTIAL_", "TERMINAL_SESSION_", "DEVICE_"}

// A 403 without a code is a credential refusal only when its text says so,
// like the middleware's "No valid api key found.".
var credentialRefusalText = regexp.MustCompile(\`(?i)(\\bapi[ _-]?key|\\bapp[ _-]?id\\b|\\bcredential|\\bunauthori[sz]ed\\b|\\bauthenticat|\\btoken\\b)\`)

// serverErrorFields reads the server's code and error text from a JSON body.
func serverErrorFields(body string) (code, message string, ok bool) {
\tvar payload map[string]any
\tif json.Unmarshal([]byte(strings.TrimSpace(body)), &payload) != nil {
\t\treturn "", "", false
\t}
\tcode, _ = payload["code"].(string)
\tif text, isText := payload["error"].(string); isText && text != "" {
\t\tmessage = text
\t} else if text, isText := payload["message"].(string); isText {
\t\tmessage = text
\t}
\treturn strings.TrimSpace(code), strings.TrimSpace(message), true
}

// isAuthForbidden reports whether a 403 body is a credential refusal.
func isAuthForbidden(body string) bool {
\tcode, message, ok := serverErrorFields(body)
\tif code != "" {
\t\tfor _, prefix := range authForbiddenCodePrefixes {
\t\t\tif strings.HasPrefix(code, prefix) {
\t\t\t\treturn true
\t\t\t}
\t\t}
\t\treturn false
\t}
\tif !ok || message == "" {
\t\tmessage = body
\t}
\treturn credentialRefusalText.MatchString(message)
}

// isScopeForbidden reports a valid credential that may not do this request.
func isScopeForbidden(body string) bool {
\tcode, _, _ := serverErrorFields(body)
\treturn code == "CLI_CREDENTIAL_SCOPE_FORBIDDEN" || strings.HasPrefix(code, "DEVICE_")
}

type serverRefusalError struct {
\tmessage string
\terr     error
}

func (e *serverRefusalError) Error() string { return e.message }
func (e *serverRefusalError) Unwrap() error { return e.err }

// serverRefusal shows a non-credential 403 as the server stated it:
// "<METHOD> <path> returned HTTP 403 <code>: <error>", with no auth hint.
func serverRefusal(err error, prefix, body string) error {
\tcode, message, _ := serverErrorFields(body)
\tif prefix == "" || message == "" {
\t\treturn err
\t}
\tif code != "" {
\t\treturn &serverRefusalError{message: fmt.Sprintf("%s %s: %s", prefix, code, message), err: err}
\t}
\treturn &serverRefusalError{message: fmt.Sprintf("%s: %s", prefix, message), err: err}
}
`;

function patchCliRetryAfterAndForbidden(sourceDir) {
  const clientDir = path.join(sourceDir, 'internal', 'client');
  const cliDir = path.join(sourceDir, 'internal', 'cli');
  const clientPath = path.join(clientDir, 'client.go');

  const apiErrorFieldPatched = replaceInFile(
    clientPath,
    /(type APIError struct \{\n(?:\t[^\n]*\n)*?\tBody\s+string\n)\}/,
    `$1\t// RetryAfterSeconds is the wait a 429 asked for, 0 when none (rtgit #3053).\n\tRetryAfterSeconds int\n}`
  );
  const retryStatePatched = replaceInFile(
    clientPath,
    /(\n)(\tfor attempt := 0; attempt <= maxRetries; attempt\+\+ \{\n)/,
    `$1\trateLimitRetries := 0\n\tvar rateLimitWaited time.Duration\n\n$2`
  );
  const retryLoopPatched = replaceInFile(
    clientPath,
    /(?:\t\t\/\/ Rate limited[^\n]*\n)?\t\tif resp\.StatusCode == 429 && attempt < maxRetries \{\n\t\t\tc\.limiter\.OnRateLimit\(\)\n\t\t\twait := cliutil\.RetryAfter\(resp\)\n[\s\S]*?\t\t\tlastErr = apiErr\n\t\t\tcontinue\n\t\t\}\n/,
    `\t\t// Rate limited: wait as long as the server asks (Retry-After, then
\t\t// the body's retry_after) within the rateLimit* bounds, else fail at
\t\t// once with retry_after. A request sent at most once (maxRetries 0)
\t\t// is never replayed (rtgit #3053).
\t\tif resp.StatusCode == 429 {
\t\t\tc.limiter.OnRateLimit()
\t\t\tserverWait, fromServer := serverRetryAfter(resp.Header, respBody, time.Now())
\t\t\tif fromServer {
\t\t\t\tapiErr.RetryAfterSeconds = retryAfterSeconds(serverWait)
\t\t\t}
\t\t\twait, retry := rateLimitRetryWait(serverWait, fromServer, rateLimitRetries, rateLimitWaited)
\t\t\tif retry && attempt < maxRetries {
\t\t\t\trateLimitRetries++
\t\t\t\trateLimitWaited += wait
\t\t\t\treason := "as the server asked"
\t\t\t\tif !fromServer {
\t\t\t\t\treason = "(the server gave no Retry-After)"
\t\t\t\t}
\t\t\t\tfmt.Fprintf(os.Stderr, "rate limited, waiting %s %s (retry %d/%d)\\n", wait, reason, rateLimitRetries, rateLimitMaxRetries)
\t\t\t\tif err := sleepContext(ctx, wait); err != nil {
\t\t\t\t\treturn nil, 0, err
\t\t\t\t}
\t\t\t\tlastErr = apiErr
\t\t\t\tcontinue
\t\t\t}
\t\t\treturn nil, resp.StatusCode, apiErr
\t\t}
`
  );

  if (!apiErrorFieldPatched || !retryStatePatched || !retryLoopPatched) {
    const missed = [
      [apiErrorFieldPatched, 'APIError retry_after field'],
      [retryStatePatched, 'retry loop state'],
      [retryLoopPatched, '429 retry'],
    ]
      .filter(([matched]) => !matched)
      .map(([, label]) => label)
      .join(', ');
    throw new Error(
      `Generated CLI Retry-After patch did not match the Printing Press output: ${missed}.`
    );
  }

  const rateLimitHelperPath = path.join(clientDir, RATE_LIMIT_HELPER_FILE);
  const forbiddenHelperPath = path.join(cliDir, FORBIDDEN_HELPER_FILE);
  fs.writeFileSync(rateLimitHelperPath, RATE_LIMIT_HELPER_SOURCE);
  fs.writeFileSync(forbiddenHelperPath, FORBIDDEN_HELPER_SOURCE);
  run('gofmt', ['-w', clientPath, rateLimitHelperPath, forbiddenHelperPath]);
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
  patchCliDelegateContracts(SOURCE_DIR);
  patchCliRetryAfterAndForbidden(SOURCE_DIR);
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
  patchCliDelegateContracts,
  patchCliRetryAfterAndForbidden,
  patchCliTerminalSessionAuth,
};
