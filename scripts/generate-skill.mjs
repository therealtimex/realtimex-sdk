#!/usr/bin/env node
/**
 * generate-skill.mjs
 *
 * Builds the RealTimeX Printing Press CLI from the app OpenAPI spec, then
 * packages the CLI-only agent skill artifacts into the TypeScript package:
 *
 *   - SKILL.md
 *   - build/stage/bin/realtimex-pp-cli
 *
 * Usage:
 *   node scripts/generate-skill.mjs --force
 *   node scripts/generate-skill.mjs --app-root ../realtimex-ai-app --force
 *   node scripts/generate-skill.mjs --spec ../realtimex-ai-app/server/swagger/openapi.json --force
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SDK_VERSION = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'typescript', 'package.json'), 'utf-8')
).version;

const DEFAULT_APP_ROOT = path.resolve(REPO_ROOT, '..', 'realtimex-ai-app');
const DEFAULT_OUT = path.join(
  REPO_ROOT,
  'typescript',
  'skills',
  'realtimex-moderator-sdk'
);
const DEFAULT_TEMPLATE = path.join(
  REPO_ROOT,
  'scripts',
  'skill-templates',
  'realtimex-moderator-sdk.md'
);

const SKILL_FILES = [
  'SKILL.md',
  path.join('build', 'stage', 'bin', 'realtimex-pp-cli'),
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
const APP_ROOT = path.resolve(flags['app-root'] || DEFAULT_APP_ROOT);
const SPEC_PATH = path.resolve(
  flags.spec || path.join(APP_ROOT, 'server', 'swagger', 'openapi.json')
);
const OUT_DIR = path.resolve(flags.out || DEFAULT_OUT);
const TEMPLATE_PATH = flags.template === false || flags.template === 'false'
  ? ''
  : path.resolve(flags.template || DEFAULT_TEMPLATE);
const CLI_NAME = String(flags.name || 'realtimex');
const AUTH_PREFERENCE = String(flags['auth-preference'] || 'AppIdAuth');
const PP_OUTPUT_DIR = path.resolve(
  flags['printing-press-out'] ||
    path.join(os.tmpdir(), `realtimex-printing-press-${process.pid}`)
);
const FILTER_PREFIX = flags['filter-prefix'] === false || flags['filter-prefix'] === 'false'
  ? ''
  : String(flags['filter-prefix'] || '/cli');
const CLI_PRINTING_PRESS_BIN = flags.bin || process.env.CLI_PRINTING_PRESS_BIN;

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

function prepareSpecForPrintingPress() {
  if (!FILTER_PREFIX) return SPEC_PATH;

  const rawSpec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf-8'));
  const filteredPaths = {};
  const usedTags = new Set();

  for (const [pathname, pathItem] of Object.entries(rawSpec.paths || {})) {
    if (!pathname.startsWith(FILTER_PREFIX)) continue;
    filteredPaths[pathname] = pathItem;

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

  const outputPath = filteredSpecPath();
  if (DRY_RUN) {
    console.log(`[DRY-RUN] write filtered spec ${outputPath}`);
    return outputPath;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(filteredSpec, null, 2)}\n`);
  console.log(
    `[generate-skill] filtered spec: ${Object.keys(filteredPaths).length} paths matching ${FILTER_PREFIX}`
  );
  return outputPath;
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

function patchCliVersion() {
  const rootGo = path.join(PP_OUTPUT_DIR, 'internal', 'cli', 'root.go');
  if (DRY_RUN) {
    console.log(`[DRY-RUN] patch ${rootGo} version to ${SDK_VERSION}`);
    return;
  }
  if (!fs.existsSync(rootGo)) return;

  const contents = fs.readFileSync(rootGo, 'utf-8');
  fs.writeFileSync(
    rootGo,
    contents.replace(/var version = ".*?"/, `var version = "${SDK_VERSION}"`)
  );
}

function rebuildSkillCliBinary() {
  if (DRY_RUN) {
    console.log(`[DRY-RUN] rebuild ${path.join(PP_OUTPUT_DIR, 'build', 'stage', 'bin', 'realtimex-pp-cli')}`);
    return;
  }

  const binPath = path.join(PP_OUTPUT_DIR, 'build', 'stage', 'bin', 'realtimex-pp-cli');
  fs.mkdirSync(path.dirname(binPath), { recursive: true });
  run('go', ['build', '-o', binPath, './cmd/realtimex-pp-cli'], {
    cwd: PP_OUTPUT_DIR,
  });
}

function prepareOutputDir() {
  if (!FORCE && fs.existsSync(OUT_DIR)) {
    throw new Error(`${OUT_DIR} already exists. Re-run with --force to replace it.`);
  }

  if (DRY_RUN) {
    console.log(`[DRY-RUN] remove ${OUT_DIR}`);
    return;
  }

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function copySkillFile(relativePath) {
  const sourcePath = path.join(PP_OUTPUT_DIR, relativePath);
  const outPath = path.join(OUT_DIR, relativePath);

  if (DRY_RUN) {
    console.log(`[DRY-RUN] copy ${sourcePath} -> ${outPath}`);
    return;
  }

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Expected Printing Press artifact missing: ${sourcePath}`);
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.copyFileSync(sourcePath, outPath);
  fs.chmodSync(outPath, fs.statSync(sourcePath).mode);
  console.log(`  copied ${rel(outPath)}`);
}

function packageSkill() {
  prepareOutputDir();
  for (const relativePath of SKILL_FILES) {
    copySkillFile(relativePath);
  }
  applySkillTemplate();
}

function parseFrontmatter(markdown) {
  if (!markdown.startsWith('---\n')) {
    return { frontmatter: '', body: markdown };
  }

  const endIndex = markdown.indexOf('\n---\n', 4);
  if (endIndex === -1) {
    return { frontmatter: '', body: markdown };
  }

  return {
    frontmatter: markdown.slice(4, endIndex),
    body: markdown.slice(endIndex + 5).replace(/^\n/, ''),
  };
}

function parseFrontmatterLines(frontmatter) {
  const values = new Map();
  for (const line of frontmatter.split('\n')) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    values.set(match[1], match[2]);
  }
  return values;
}

function mergeFrontmatter(baseFrontmatter, templateFrontmatter) {
  const overrides = parseFrontmatterLines(templateFrontmatter);
  if (!overrides.size) return baseFrontmatter;

  const seen = new Set();
  const lines = baseFrontmatter.split('\n').map((line) => {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match || !overrides.has(match[1])) return line;
    seen.add(match[1]);
    return `${match[1]}: ${overrides.get(match[1])}`;
  });

  for (const [key, value] of overrides.entries()) {
    if (!seen.has(key)) lines.push(`${key}: ${value}`);
  }

  return lines.join('\n');
}

function sectionTitle(sectionMarkdown) {
  const match = sectionMarkdown.match(/^##\s+(.+?)\s*$/m);
  return match?.[1]?.trim();
}

function replaceSection(markdown, title, replacement) {
  const heading = `## ${title}`;
  const start = markdown.indexOf(heading);
  if (start === -1) {
    return `${markdown.trimEnd()}\n\n${replacement.trim()}\n`;
  }

  const next = markdown.indexOf('\n## ', start + heading.length);
  const end = next === -1 ? markdown.length : next + 1;
  return `${markdown.slice(0, start)}${replacement.trim()}\n\n${markdown.slice(end).replace(/^\n/, '')}`;
}

function applySkillTemplate() {
  const skillPath = path.join(OUT_DIR, 'SKILL.md');
  if (DRY_RUN) {
    console.log(`[DRY-RUN] apply skill template ${TEMPLATE_PATH} to ${skillPath}`);
    return;
  }
  if (!fs.existsSync(skillPath) || !TEMPLATE_PATH || !fs.existsSync(TEMPLATE_PATH)) return;

  const base = parseFrontmatter(fs.readFileSync(skillPath, 'utf-8'));
  const template = parseFrontmatter(
    fs.readFileSync(TEMPLATE_PATH, 'utf-8').replaceAll('${SDK_VERSION}', SDK_VERSION)
  );
  let body = base.body;

  for (const section of template.body.split(/\n(?=##\s+)/).map((part) => part.trim()).filter(Boolean)) {
    const title = sectionTitle(section);
    if (!title) continue;
    body = replaceSection(body, title, section);
  }

  const frontmatter = mergeFrontmatter(base.frontmatter, template.frontmatter);
  fs.writeFileSync(skillPath, `---\n${frontmatter.trim()}\n---\n\n${body.trim()}\n`);
}

function main() {
  validateInputs();

  console.log(`[generate-skill] spec: ${SPEC_PATH}`);
  console.log(`[generate-skill] printing-press output: ${PP_OUTPUT_DIR}`);
  console.log(`[generate-skill] skill output: ${OUT_DIR}`);

  generatePrintingPressProject();
  patchCliVersion();
  rebuildSkillCliBinary();
  packageSkill();

  console.log('[generate-skill] done');
}

try {
  main();
} catch (error) {
  console.error(`[generate-skill] ${error.message}`);
  process.exit(1);
}
