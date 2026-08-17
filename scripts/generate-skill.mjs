#!/usr/bin/env node
/**
 * generate-skill.mjs
 *
 * Generates the RealTimeX Printing Press project from the SDK repo OpenAPI spec,
 * then packages a concise router and focused CLI agent skills into the TypeScript
 * package:
 *
 *   - skills/realtimex-moderator-sdk (router)
 *   - skills/realtimex-* (focused capability skills)
 *
 * The realtimex-pp-cli binary is distributed separately through
 * @realtimex/pp-cli. The skill installs that pinned package at runtime.
 *
 * Usage:
 *   node scripts/generate-skill.mjs --force
 *   node scripts/generate-skill.mjs --spec ./openapi.json --force
 *   node scripts/generate-skill.mjs --out /tmp/generated-skills --force
 *
 * By default this reads ./openapi.json from the SDK repo root.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import {
  DOMAIN_SKILLS,
  ROUTER_SKILL,
  assignOperationsToDomains,
  parseCommandReference,
  renderDomainSkill,
  renderRouterSkill,
} from './skill-domains.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SDK_VERSION = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'typescript', 'package.json'), 'utf-8')
).version;

const DEFAULT_SPEC = path.resolve(REPO_ROOT, 'openapi.json');
const DEFAULT_OUT_ROOT = path.join(REPO_ROOT, 'typescript', 'skills');
const TEMPLATE_ASSETS_DIR = path.join(REPO_ROOT, 'scripts', 'skill-templates');

const TEMPLATE_ASSETS = [
  {
    source: 'AGENTS.template.md',
    output: path.join('templates', 'AGENTS.template.md'),
  },
  {
    source: 'HEARTBEAT.template.md',
    output: path.join('templates', 'HEARTBEAT.template.md'),
  },
];

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const [key, ...rest] = argv[i].slice(2).split('=');
    flags[key] = rest.length
      ? rest.join('=')
      : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true);
  }
  return flags;
}

const flags = parseFlags(process.argv.slice(2));
const DRY_RUN = flags['dry-run'] === true || flags['dry-run'] === 'true';
const FORCE = flags.force === true || flags.force === 'true';
const SPEC_PATH = path.resolve(flags.spec || DEFAULT_SPEC);
const OUT_ROOT = path.resolve(flags.out || DEFAULT_OUT_ROOT);
const OUT_DIR = path.join(OUT_ROOT, ROUTER_SKILL.name);
const CLI_NAME = String(flags.name || 'realtimex');
const AUTH_PREFERENCE = String(flags['auth-preference'] || 'AppIdAuth');
const PP_OUTPUT_DIR = path.resolve(
  flags['printing-press-out'] ||
    path.join(os.tmpdir(), `realtimex-printing-press-${process.pid}`)
);
const FILTER_PREFIX = flags['filter-prefix'] === false || flags['filter-prefix'] === 'false'
  ? ''
  : String(flags['filter-prefix'] || '/cli');
const STRIP_PATH_PREFIX = flags['strip-path-prefix'] === false || flags['strip-path-prefix'] === 'false'
  ? ''
  : String(flags['strip-path-prefix'] || FILTER_PREFIX);
const CLI_PRINTING_PRESS_BIN = flags.bin || process.env.CLI_PRINTING_PRESS_BIN;
const DEFAULT_CLI_TIMEOUT = String(
  flags['default-cli-timeout'] ||
    process.env.PP_CLI_DEFAULT_TIMEOUT ||
    '5*time.Minute'
);

function rel(filePath) {
  return path.relative(REPO_ROOT, filePath);
}

function run(command, args, options = {}) {
  const printable = [command, ...args].join(' ');
  console.log(`$ ${printable}`);

  if (DRY_RUN) return;

  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
    env: {
      ...process.env,
      XDG_CACHE_HOME:
        process.env.XDG_CACHE_HOME ||
        path.join(os.tmpdir(), 'realtimex-sdk-cache'),
      GOCACHE:
        process.env.GOCACHE ||
        path.join(os.tmpdir(), 'realtimex-sdk-go-build-cache'),
    },
    ...options,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${printable}`);
  }
}

function commandOutput(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf-8',
    shell: false,
  });

  if (result.error || result.status !== 0) return '';
  return result.stdout.trim();
}

function findCliPrintingPress() {
  if (CLI_PRINTING_PRESS_BIN) return CLI_PRINTING_PRESS_BIN;

  const fromPath = commandOutput('which', ['cli-printing-press']);
  if (fromPath) return fromPath;

  const gopath = commandOutput('go', ['env', 'GOPATH']);
  if (gopath) {
    const candidate = path.join(gopath, 'bin', 'cli-printing-press');
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(
    'cli-printing-press not found. Install with: go install github.com/mvanhorn/cli-printing-press/v4/cmd/cli-printing-press@latest'
  );
}

function validateInputs() {
  if (!fs.existsSync(SPEC_PATH)) {
    throw new Error(`OpenAPI spec not found: ${SPEC_PATH}`);
  }
}

function filteredSpecPath() {
  return path.join(PP_OUTPUT_DIR, 'filtered-openapi.json');
}

function writePreparedSpec(preparedSpec, message) {
  const outputPath = filteredSpecPath();
  if (DRY_RUN) {
    console.log(`[DRY-RUN] write prepared spec ${outputPath}`);
    return outputPath;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(preparedSpec, null, 2)}\n`);
  console.log(message);
  return outputPath;
}

function stripPathPrefix(pathname) {
  if (!STRIP_PATH_PREFIX || !pathname.startsWith(STRIP_PATH_PREFIX)) {
    return pathname;
  }

  const stripped = pathname.slice(STRIP_PATH_PREFIX.length);
  return stripped.startsWith('/') ? stripped : `/${stripped}`;
}

function appendServerPathPrefix(serverUrl, prefix) {
  if (!prefix || !serverUrl || typeof serverUrl !== 'string') {
    return serverUrl;
  }

  const normalizedPrefix = prefix.startsWith('/') ? prefix : `/${prefix}`;
  const trimmedServerUrl = serverUrl.replace(/\/+$/, '');
  if (trimmedServerUrl.endsWith(normalizedPrefix)) {
    return trimmedServerUrl;
  }
  return `${trimmedServerUrl}${normalizedPrefix}`;
}

function prepareSpecForPrintingPress() {
  const rawSpec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf-8'));
  const specInfo = {
    ...(rawSpec.info || {}),
    version: SDK_VERSION,
  };

  if (!FILTER_PREFIX) {
    return writePreparedSpec(
      {
        ...rawSpec,
        info: specInfo,
      },
      `[generate-skill] prepared spec version: ${SDK_VERSION}`
    );
  }

  const filteredPaths = {};
  const usedTags = new Set();

  for (const [pathname, pathItem] of Object.entries(rawSpec.paths || {})) {
    if (!pathname.startsWith(FILTER_PREFIX)) continue;
    filteredPaths[stripPathPrefix(pathname)] = pathItem;

    for (const operation of Object.values(pathItem || {})) {
      if (!operation || typeof operation !== 'object') continue;
      for (const tag of operation.tags || []) usedTags.add(tag);
    }
  }

  if (!Object.keys(filteredPaths).length) {
    throw new Error(`No OpenAPI paths matched filter prefix: ${FILTER_PREFIX}`);
  }

  const filteredSpec = {
    ...rawSpec,
    info: specInfo,
    servers: Array.isArray(rawSpec.servers)
      ? rawSpec.servers.map((server) => ({
          ...server,
          url: appendServerPathPrefix(server.url, STRIP_PATH_PREFIX),
        }))
      : rawSpec.servers,
    tags: Array.isArray(rawSpec.tags)
      ? rawSpec.tags.filter((tag) => usedTags.has(tag.name))
      : rawSpec.tags,
    paths: filteredPaths,
  };

  const securitySchemes = filteredSpec.components?.securitySchemes || {};
  if (
    AUTH_PREFERENCE === 'AppIdAuth' &&
    !securitySchemes.AppIdAuth &&
    securitySchemes.SDKAppId
  ) {
    securitySchemes.AppIdAuth = {
      ...securitySchemes.SDKAppId,
      description:
        securitySchemes.SDKAppId.description ||
        'LocalApp ID for x-app-id API access',
    };
  }

  if (securitySchemes[AUTH_PREFERENCE]) {
    filteredSpec.security = [{ [AUTH_PREFERENCE]: [] }];
  }

  return writePreparedSpec(
    filteredSpec,
    `[generate-skill] filtered spec: ${Object.keys(filteredPaths).length} paths matching ${FILTER_PREFIX}` +
      (STRIP_PATH_PREFIX ? `, stripped ${STRIP_PATH_PREFIX}` : '')
  );
}

function generatePrintingPressProject() {
  const cliPrintingPress = findCliPrintingPress();
  const specForGeneration = prepareSpecForPrintingPress();
  const args = [
    'generate',
    '--spec',
    specForGeneration,
    '--name',
    CLI_NAME,
    '--auth-preference',
    AUTH_PREFERENCE,
    '--output',
    PP_OUTPUT_DIR,
    '--force',
  ];

  run(cliPrintingPress, args);
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

function patchCliVersion() {
  if (DRY_RUN) {
    console.log(`[DRY-RUN] patch generated CLI version to ${SDK_VERSION}`);
    return;
  }

  const versionPatched = [
    path.join(PP_OUTPUT_DIR, 'internal', 'cli', 'version.go'),
    path.join(PP_OUTPUT_DIR, 'internal', 'cli', 'root.go'),
  ].some((filePath) =>
    replaceInFile(filePath, /var version = ".*?"/, `var version = "${SDK_VERSION}"`)
  );

  if (!versionPatched) {
    throw new Error('Generated CLI version variable not found; cannot pin realtimex-pp-cli version.');
  }

  replaceInFile(
    path.join(PP_OUTPUT_DIR, 'internal', 'client', 'client.go'),
    /(req\.Header\.Set\("User-Agent",\s*)"realtimex-pp-cli\/[^"]+"/,
    `$1"realtimex-pp-cli/${SDK_VERSION}"`
  );
}

function patchGeneratedCliDefaults() {
  const rootGo = path.join(PP_OUTPUT_DIR, 'internal', 'cli', 'root.go');
  if (DRY_RUN) {
    console.log(`[DRY-RUN] patch ${rootGo} default timeout to ${DEFAULT_CLI_TIMEOUT}`);
    return;
  }
  if (!fs.existsSync(rootGo)) return;

  const contents = fs.readFileSync(rootGo, 'utf-8');
  const patched = contents.replace(
    /DurationVar\(&flags\.timeout, "timeout", [^,]+, "Request timeout"\)/,
    `DurationVar(&flags.timeout, "timeout", ${DEFAULT_CLI_TIMEOUT}, "Request timeout")`
  );
  fs.writeFileSync(rootGo, patched);
}

function copyTemplateAsset(asset, outDir) {
  const sourcePath = path.join(TEMPLATE_ASSETS_DIR, asset.source);
  const outPath = path.join(outDir, asset.output);

  if (DRY_RUN) {
    console.log(`[DRY-RUN] copy ${sourcePath} -> ${outPath}`);
    return;
  }

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Expected skill template asset missing: ${sourcePath}`);
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.copyFileSync(sourcePath, outPath);
  console.log(`  copied ${rel(outPath)}`);
}

function packageSkills() {
  const skillNames = [ROUTER_SKILL.name, ...DOMAIN_SKILLS.map((domain) => domain.name)];
  const outputDirs = skillNames.map((name) => path.join(OUT_ROOT, name));
  const existing = outputDirs.filter((dir) => fs.existsSync(dir));
  if (!FORCE && existing.length) {
    throw new Error(`${existing[0]} already exists. Re-run with --force to replace generated skills.`);
  }
  if (DRY_RUN) {
    for (const dir of outputDirs) console.log(`[DRY-RUN] replace ${dir}`);
    return;
  }

  const generatedSkillPath = path.join(PP_OUTPUT_DIR, 'SKILL.md');
  if (!fs.existsSync(generatedSkillPath)) {
    throw new Error(`Expected Printing Press artifact missing: ${generatedSkillPath}`);
  }
  const commandBlocks = parseCommandReference(
    fs.readFileSync(generatedSkillPath, 'utf-8')
  );
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf-8'));
  const assignments = assignOperationsToDomains(spec, FILTER_PREFIX);
  const assignedCommands = new Set(
    [...assignments.values()].flat().map((operation) => operation.commandName)
  );
  const unassignedCommands = [...commandBlocks.keys()].filter(
    (commandName) => !assignedCommands.has(commandName)
  );
  if (unassignedCommands.length) {
    throw new Error(`Generated commands have no skill owner: ${unassignedCommands.join(', ')}`);
  }

  for (const dir of outputDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(OUT_DIR, 'SKILL.md'),
    renderRouterSkill(SDK_VERSION)
  );
  console.log(`  generated ${rel(path.join(OUT_DIR, 'SKILL.md'))}`);

  for (const domain of DOMAIN_SKILLS) {
    const domainDir = path.join(OUT_ROOT, domain.name);
    fs.writeFileSync(
      path.join(domainDir, 'SKILL.md'),
      renderDomainSkill(
        domain,
        assignments.get(domain.name),
        commandBlocks,
        SDK_VERSION
      )
    );
    console.log(`  generated ${rel(path.join(domainDir, 'SKILL.md'))}`);
  }

  for (const asset of TEMPLATE_ASSETS) copyTemplateAsset(asset, OUT_DIR);
  copyTemplateAsset(TEMPLATE_ASSETS[0], path.join(OUT_ROOT, 'realtimex-workspaces'));
  copyTemplateAsset(TEMPLATE_ASSETS[1], path.join(OUT_ROOT, 'realtimex-heartbeat'));
}

function main() {
  validateInputs();

  console.log(`[generate-skill] spec: ${SPEC_PATH}`);
  console.log(`[generate-skill] printing-press output: ${PP_OUTPUT_DIR}`);
  console.log(`[generate-skill] skills output: ${OUT_ROOT}`);

  generatePrintingPressProject();
  patchCliVersion();
  patchGeneratedCliDefaults();
  packageSkills();

  console.log('[generate-skill] done');
}

try {
  main();
} catch (error) {
  console.error(`[generate-skill] ${error.message}`);
  process.exit(1);
}
