#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Immutable provenance identifier; this is not a Proxy Max product label.
const SOURCE_REPOSITORY = 'https://github.com/decolua/9router';
const EXPECTED_REVISION = '79918c7830695bbca4a45c9fea4a42c3e9fd73d1';
const EXPECTED_TAG = 'v0.5.40';
const SCHEMA_VERSION = 1;
const CLASSIFICATION_RULES_VERSION = 1;
const DEFAULT_STATUS = 'unmapped';
const CLASSIFICATIONS = Object.freeze([
  'api-route',
  'ui-page/component',
  'provider',
  'executor',
  'translator',
  'test',
  'docs/i18n',
  'skill',
  'asset',
  'cli',
  'infra',
  'other',
]);

function usage() {
  return [
    'Usage:',
    '  node scripts/generate-unified-parity.js \\',
    '    --upstream /path/to/unified \\',
    '    --output docs/parity/upstream-v0.5.40.json',
    '',
    `The upstream checkout must be exactly ${EXPECTED_TAG} (${EXPECTED_REVISION}).`,
  ].join('\n');
}

function parseArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }

    let key;
    let value;
    const equalsIndex = argument.indexOf('=');
    if (equalsIndex > 0) {
      key = argument.slice(0, equalsIndex);
      value = argument.slice(equalsIndex + 1);
    } else {
      key = argument;
      value = argv[index + 1];
      index += 1;
    }

    if (key !== '--upstream' && key !== '--output') {
      throw new Error(`Unknown argument: ${argument}`);
    }
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${key}`);
    }

    options[key.slice(2)] = value;
  }

  if (!options.help && (!options.upstream || !options.output)) {
    throw new Error('Both --upstream and --output are required.');
  }

  return options;
}

function runGit(upstream, args, options = {}) {
  const result = spawnSync('git', ['-C', upstream, ...args], {
    encoding: options.encoding === undefined ? 'utf8' : options.encoding,
    input: options.input,
    maxBuffer: 512 * 1024 * 1024,
  });

  if (result.error) {
    throw new Error(`Unable to run git ${args.join(' ')}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString('utf8')
      : result.stderr;
    throw new Error(
      `git ${args.join(' ')} failed with exit code ${result.status}: ${String(stderr || '').trim()}`,
    );
  }

  return result.stdout;
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function verifyUpstream(upstreamPath) {
  const upstream = path.resolve(upstreamPath);
  if (!fs.existsSync(upstream)) {
    throw new Error(`Upstream path does not exist: ${upstream}`);
  }

  const insideWorkTree = runGit(upstream, ['rev-parse', '--is-inside-work-tree']).trim();
  if (insideWorkTree !== 'true') {
    throw new Error(`Upstream path is not a Git worktree: ${upstream}`);
  }

  const revision = runGit(upstream, ['rev-parse', '--verify', 'HEAD']).trim();
  if (revision !== EXPECTED_REVISION) {
    throw new Error(
      `Unexpected upstream revision: expected ${EXPECTED_REVISION}, received ${revision}`,
    );
  }

  const tags = runGit(upstream, ['tag', '--points-at', 'HEAD'])
    .split(/\r?\n/u)
    .filter(Boolean)
    .sort(compareStrings);
  if (!tags.includes(EXPECTED_TAG)) {
    throw new Error(
      `Expected exact tag ${EXPECTED_TAG} at ${revision}; found ${tags.join(', ') || 'none'}`,
    );
  }

  const trackedStatus = spawnSync(
    'git',
    ['-C', upstream, 'status', '--porcelain=v1', '--untracked-files=no'],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  if (trackedStatus.error || trackedStatus.status !== 0) {
    throw new Error('Unable to verify whether the upstream checkout has tracked changes.');
  }
  if (trackedStatus.stdout.trim()) {
    throw new Error(
      'The upstream checkout has tracked changes; parity must be generated from the exact tagged tree.',
    );
  }

  const tree = runGit(upstream, ['rev-parse', 'HEAD^{tree}']).trim();
  return { upstream, revision, tag: EXPECTED_TAG, tree };
}

function parseIndexEntries(buffer) {
  const entries = [];
  for (const record of buffer.toString('utf8').split('\0')) {
    if (!record) continue;
    const match = /^(\d{6}) ([0-9a-f]+) (\d)\t([\s\S]+)$/u.exec(record);
    if (!match) {
      throw new Error(`Unable to parse git ls-files --stage entry: ${record}`);
    }
    const [, mode, oid, stage, filePath] = match;
    if (stage !== '0') {
      throw new Error(`Unmerged index entry is not supported: ${filePath}`);
    }
    if (mode !== '100644' && mode !== '100755' && mode !== '120000') {
      throw new Error(`Unsupported tracked entry mode ${mode}: ${filePath}`);
    }
    entries.push({ path: filePath, mode, oid });
  }
  return entries;
}

function readGitObjects(upstream, entries) {
  const objectRequest = Buffer.from(`${entries.map((entry) => entry.oid).join('\n')}\n`, 'utf8');
  const output = runGit(upstream, ['cat-file', '--batch'], {
    encoding: null,
    input: objectRequest,
  });
  const objects = [];
  let offset = 0;

  for (const entry of entries) {
    const headerEnd = output.indexOf(0x0a, offset);
    if (headerEnd === -1) {
      throw new Error(`Truncated git cat-file response for ${entry.path}`);
    }

    const header = output.subarray(offset, headerEnd).toString('utf8');
    const match = /^([0-9a-f]+) (\S+) (\d+)$/u.exec(header);
    if (!match) {
      throw new Error(`Unexpected git cat-file response for ${entry.path}: ${header}`);
    }

    const [, oid, type, sizeText] = match;
    const size = Number(sizeText);
    if (oid !== entry.oid) {
      throw new Error(`Git object order mismatch for ${entry.path}`);
    }
    if (type !== 'blob') {
      throw new Error(`Tracked entry is not a Git blob (${type}): ${entry.path}`);
    }

    const contentStart = headerEnd + 1;
    const contentEnd = contentStart + size;
    if (contentEnd >= output.length || output[contentEnd] !== 0x0a) {
      throw new Error(`Truncated Git blob content for ${entry.path}`);
    }

    objects.push(output.subarray(contentStart, contentEnd));
    offset = contentEnd + 1;
  }

  if (offset !== output.length) {
    throw new Error('Unexpected trailing data from git cat-file --batch.');
  }

  return objects;
}

function listTrackedFiles(upstream) {
  const exactPaths = runGit(upstream, ['ls-files', '-z'], { encoding: null })
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  const entries = parseIndexEntries(
    runGit(upstream, ['ls-files', '--stage', '-z'], { encoding: null }),
  );

  const stagedPaths = entries.map((entry) => entry.path);
  if (
    exactPaths.length !== stagedPaths.length ||
    exactPaths.some((filePath, index) => filePath !== stagedPaths[index])
  ) {
    throw new Error('git ls-files and git ls-files --stage returned different tracked paths.');
  }

  const contents = readGitObjects(upstream, entries);
  return entries
    .map((entry, index) => ({
      path: entry.path,
      sha256: crypto.createHash('sha256').update(contents[index]).digest('hex'),
      size: contents[index].length,
    }))
    .sort((left, right) => compareStrings(left.path, right.path));
}

function classifyPath(filePath) {
  const normalized = filePath.replaceAll('\\', '/');
  const lower = normalized.toLowerCase();
  const basename = lower.slice(lower.lastIndexOf('/') + 1);

  if (lower.startsWith('cli/')) return 'cli';
  if (lower.startsWith('skills/')) return 'skill';

  if (
    lower.startsWith('tests/') ||
    lower.includes('/__tests__/') ||
    lower.includes('/__snapshots__/') ||
    /(^|[._-])(test|tests|spec|snapshot)([._-]|$)/u.test(basename) ||
    basename.endsWith('.snap')
  ) {
    return 'test';
  }

  if (lower.startsWith('src/app/api/')) return 'api-route';
  if (lower.startsWith('open-sse/executors/')) return 'executor';
  if (
    lower.startsWith('open-sse/translator/') ||
    lower.startsWith('open-sse/transformer/')
  ) {
    return 'translator';
  }

  if (
    lower.startsWith('docs/') ||
    lower.startsWith('i18n/') ||
    lower.startsWith('gitbook/') ||
    lower.startsWith('public/i18n/') ||
    lower.startsWith('src/i18n/') ||
    /(^|\/)(readme|changelog|claude|agents|docker)(\.[^/]*)?$/u.test(lower) ||
    lower === 'license' ||
    lower === 'scripts/translate-readme.js'
  ) {
    return 'docs/i18n';
  }

  if (
    lower.startsWith('images/') ||
    lower.startsWith('public/') ||
    /\.(avif|bmp|css|gif|ico|jpe?g|png|svg|webp|woff2?|ttf|eot)$/u.test(lower)
  ) {
    return 'asset';
  }

  if (
    lower.startsWith('open-sse/providers/') ||
    /^open-sse\/handlers\/(embeddingproviders|imageproviders|ttsproviders)\//u.test(lower) ||
    /^open-sse\/(config|services)\/[^/]*(model|provider)/u.test(lower) ||
    lower === 'src/lib/providernormalization.js'
  ) {
    return 'provider';
  }

  if (
    lower.startsWith('src/app/') ||
    lower.startsWith('src/shared/components/') ||
    lower.startsWith('src/shared/hooks/') ||
    lower.startsWith('src/store/')
  ) {
    return 'ui-page/component';
  }

  if (
    lower.startsWith('.github/') ||
    lower.startsWith('.vscode/') ||
    lower.startsWith('scripts/') ||
    /(^|\/)(package\.json|dockerfile|docker-compose\.ya?ml|captain-definition)$/u.test(lower) ||
    /(^|\/)(eslint|jsconfig|next|postcss)\.config\.[^/]+$/u.test(lower) ||
    /(^|\/)(\.dockerignore|\.env\.example|\.gitignore|\.npmignore)$/u.test(lower) ||
    lower === 'custom-server.js' ||
    lower === 'start.sh'
  ) {
    return 'infra';
  }

  return 'other';
}

function canonicalizePreservedValue(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalizePreservedValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort(compareStrings)
        .map((key) => [key, canonicalizePreservedValue(value[key])]),
    );
  }
  return value;
}

function readPreviousEntries(outputPath) {
  if (!fs.existsSync(outputPath)) return new Map();

  let previous;
  try {
    previous = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to parse prior manifest ${outputPath}: ${error.message}`);
  }
  if (!previous || !Array.isArray(previous.files)) {
    throw new Error(`Prior manifest does not contain a files array: ${outputPath}`);
  }

  const entries = new Map();
  for (const entry of previous.files) {
    if (!entry || typeof entry.path !== 'string') {
      throw new Error(`Prior manifest contains a file entry without a valid path: ${outputPath}`);
    }
    if (entries.has(entry.path)) {
      throw new Error(`Prior manifest contains a duplicate path: ${entry.path}`);
    }
    entries.set(entry.path, entry);
  }
  return entries;
}

function preserveMapping(previous) {
  const mapping = {
    status: DEFAULT_STATUS,
    target: null,
    notes: null,
  };
  if (!previous) return mapping;

  for (const field of ['status', 'target', 'notes']) {
    if (Object.prototype.hasOwnProperty.call(previous, field)) {
      mapping[field] = canonicalizePreservedValue(previous[field]);
    }
  }
  if (typeof mapping.status !== 'string' || !mapping.status.trim()) {
    throw new Error(`Prior status must be a non-empty string for ${previous.path}`);
  }
  return mapping;
}

function buildSummary(files) {
  const byClassification = Object.fromEntries(
    CLASSIFICATIONS.map((classification) => [classification, 0]),
  );
  const statusCounts = new Map();
  let totalBytes = 0;

  for (const file of files) {
    byClassification[file.classification] += 1;
    statusCounts.set(file.status, (statusCounts.get(file.status) || 0) + 1);
    totalBytes += file.size;
  }

  const byStatus = Object.fromEntries(
    [...statusCounts.entries()].sort(([left], [right]) => compareStrings(left, right)),
  );
  const unmapped = statusCounts.get(DEFAULT_STATUS) || 0;
  return {
    totalFiles: files.length,
    totalBytes,
    unmapped,
    zeroUnmapped: unmapped === 0,
    byClassification,
    byStatus,
  };
}

function buildManifest(upstreamPath, outputPath) {
  const source = verifyUpstream(upstreamPath);
  const previousEntries = readPreviousEntries(path.resolve(outputPath));
  const trackedFiles = listTrackedFiles(source.upstream);
  const files = trackedFiles.map((file) => ({
    path: file.path,
    sha256: file.sha256,
    size: file.size,
    classification: classifyPath(file.path),
    ...preserveMapping(previousEntries.get(file.path)),
  }));
  const summary = buildSummary(files);

  return {
    schemaVersion: SCHEMA_VERSION,
    classificationRulesVersion: CLASSIFICATION_RULES_VERSION,
    source: {
      repository: SOURCE_REPOSITORY,
      tag: source.tag,
      revision: source.revision,
      tree: source.tree,
    },
    summary,
    files,
  };
}

function generateManifest({ upstream, output }) {
  const outputPath = path.resolve(output);
  const manifest = buildManifest(upstream, outputPath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }

    const manifest = generateManifest(options);
    process.stdout.write(
      [
        `Verified ${manifest.source.tag} (${manifest.source.revision}).`,
        `Wrote ${manifest.summary.totalFiles} tracked files to ${path.resolve(options.output)}.`,
        `Unmapped: ${manifest.summary.unmapped}; bytes: ${manifest.summary.totalBytes}.`,
      ].join('\n') + '\n',
    );
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  CLASSIFICATIONS,
  EXPECTED_REVISION,
  EXPECTED_TAG,
  buildManifest,
  buildSummary,
  classifyPath,
  generateManifest,
  listTrackedFiles,
  parseArgs,
  preserveMapping,
  verifyUpstream,
};
