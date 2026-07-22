#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  CLASSIFICATIONS,
  EXPECTED_REVISION,
  EXPECTED_TAG,
  classifyPath,
} = require('./generate-unified-parity');

const ROOT = path.resolve(__dirname, '..');
const SCHEMA_VERSION = 1;
const PINNED_INVENTORY = Object.freeze({
  repository: 'https://github.com/decolua/9router',
  tag: EXPECTED_TAG,
  revision: EXPECTED_REVISION,
  tree: '7aa8d7fb8a0233b4678255bc45128f159d74b381',
  totalFiles: 1342,
  totalBytes: 9968328,
  semanticSha256: '358fcdedfd3427487d330879d912cc317a26df7fc7c2f79f81f6bd495075f132',
});
const DEFAULT_PATHS = Object.freeze({
  inventory: 'docs/parity/upstream-v0.5.40.json',
  snapshot: 'upstream/router-core',
  overlays: 'overlays/unified',
  materializer: 'src/runtime/unified-source.js',
  output: 'docs/parity/upstream-v0.5.40.ledger.json',
});
const DISPOSITIONS = Object.freeze([
  'vendored-unchanged',
  'overlaid',
  'proxy-max-addition',
]);
const UPSTREAM_DISPOSITIONS = new Set(['vendored-unchanged', 'overlaid']);
const RUNTIME_TREATMENTS = Object.freeze({
  test: 'verification-source',
  'docs/i18n': 'documentation-or-localization-source',
  asset: 'static-asset-source',
  skill: 'agent-skill-source',
  cli: 'cli-source',
  infra: 'build-or-operations-source',
});
const RESERVED_OVERLAY_PATHS = new Set(['.proxy-max-source.json', 'package-lock.json']);

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function normalizeRelativePath(value, label = 'path') {
  const normalized = String(value || '').replaceAll('\\', '/').replace(/^\.\//u, '');
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  if (normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Unsafe ${label}: ${value}`);
  }
  return normalized;
}

function resolveInside(root, relativePath, label = 'path') {
  const normalized = normalizeRelativePath(relativePath, label);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...normalized.split('/'));
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`${label} escapes workspace: ${relativePath}`);
  }
  return resolved;
}

function projectPath(workspace, absolutePath, label) {
  const relative = path.relative(path.resolve(workspace), path.resolve(absolutePath));
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} must be inside the workspace: ${absolutePath}`);
  }
  return normalizeRelativePath(relative, label);
}

function readBlob(filePath, label) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Missing ${label}: ${filePath}`);
    throw error;
  }
  if (stat.isSymbolicLink()) {
    return Buffer.from(fs.readlinkSync(filePath), 'utf8');
  }
  if (!stat.isFile()) throw new Error(`${label} is not a regular file: ${filePath}`);
  return fs.readFileSync(filePath);
}

function blobRecord(filePath, label) {
  const content = readBlob(filePath, label);
  return { sha256: sha256(content), size: content.length };
}

function listFiles(directory, prefix = '') {
  if (!fs.existsSync(directory)) return [];
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => compareStrings(left.name, right.name))) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Overlay symlinks are not allowed: ${relativePath}`);
    }
    if (entry.isDirectory()) output.push(...listFiles(absolutePath, relativePath));
    else if (entry.isFile()) output.push(normalizeRelativePath(relativePath, 'overlay path'));
    else throw new Error(`Unsupported overlay entry: ${relativePath}`);
  }
  return output;
}

function listSnapshotFiles(directory, prefix = '') {
  const ignoredRootEntries = new Set([
    '.git',
    '.next',
    'coverage',
    'node_modules',
    'package-lock.json',
  ]);
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => compareStrings(left.name, right.name))) {
    if (!prefix && ignoredRootEntries.has(entry.name)) continue;
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...listSnapshotFiles(absolutePath, relativePath));
    else if (entry.isFile() || entry.isSymbolicLink()) {
      output.push(normalizeRelativePath(relativePath, 'snapshot path'));
    } else throw new Error(`Unsupported snapshot entry: ${relativePath}`);
  }
  return output;
}

function increment(object, key) {
  object[key] = (object[key] || 0) + 1;
}

function validateOverlayTopology(overlayPaths, pinnedPaths) {
  for (const overlayPath of overlayPaths) {
    if (RESERVED_OVERLAY_PATHS.has(overlayPath)) {
      throw new Error(`Overlay collides with a generated runtime artifact: ${overlayPath}`);
    }
    const parts = overlayPath.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      const ancestor = parts.slice(0, index).join('/');
      if (pinnedPaths.has(ancestor)) {
        throw new Error(
          `Overlay path ${overlayPath} is nested beneath pinned file ${ancestor}`,
        );
      }
    }
    const descendantPrefix = `${overlayPath}/`;
    for (const pinnedPath of pinnedPaths) {
      if (pinnedPath.startsWith(descendantPrefix)) {
        throw new Error(
          `Overlay file ${overlayPath} would replace a directory containing ${pinnedPath}`,
        );
      }
    }
  }
}

function sortedCountObject(counts) {
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => compareStrings(left, right)),
  );
}

function inventorySemanticDigest(inventory) {
  const semanticInventory = {
    source: {
      repository: inventory.source.repository,
      tag: inventory.source.tag,
      revision: inventory.source.revision,
      tree: inventory.source.tree,
    },
    files: inventory.files.map(({ path: filePath, sha256: blobSha256, size, classification }) => ({
      path: filePath,
      sha256: blobSha256,
      size,
      classification,
    })),
  };
  return sha256(Buffer.from(JSON.stringify(semanticInventory), 'utf8'));
}

function loadInventory(inventoryPath, expectedIdentity = PINNED_INVENTORY) {
  let inventory;
  try {
    inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read pinned inventory ${inventoryPath}: ${error.message}`);
  }
  if (
    inventory?.source?.repository !== expectedIdentity.repository ||
    inventory?.source?.tag !== expectedIdentity.tag ||
    inventory?.source?.revision !== expectedIdentity.revision ||
    inventory?.source?.tree !== expectedIdentity.tree
  ) {
    throw new Error(
      `Pinned inventory identity mismatch; expected ${expectedIdentity.tag} (${
        expectedIdentity.revision
      }) tree ${expectedIdentity.tree}`,
    );
  }
  if (!Array.isArray(inventory.files) || inventory.files.length === 0) {
    throw new Error('Pinned inventory must contain a non-empty files array.');
  }

  const paths = new Set();
  const classificationCounts = Object.fromEntries(
    CLASSIFICATIONS.map((classification) => [classification, 0]),
  );
  let previousPath = null;
  let totalBytes = 0;
  for (const entry of inventory.files) {
    const relativePath = normalizeRelativePath(entry?.path, 'inventory path');
    if (paths.has(relativePath)) throw new Error(`Duplicate pinned inventory path: ${relativePath}`);
    if (previousPath !== null && compareStrings(previousPath, relativePath) >= 0) {
      throw new Error(`Pinned inventory paths are not strictly sorted: ${relativePath}`);
    }
    if (!/^[0-9a-f]{64}$/u.test(entry.sha256 || '')) {
      throw new Error(`Invalid pinned SHA-256 for ${relativePath}`);
    }
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
      throw new Error(`Invalid pinned byte size for ${relativePath}`);
    }
    if (entry.classification !== classifyPath(relativePath)) {
      throw new Error(`Stale pinned classification for ${relativePath}`);
    }
    paths.add(relativePath);
    classificationCounts[entry.classification] += 1;
    previousPath = relativePath;
    totalBytes += entry.size;
  }
  if (inventory.summary?.totalFiles !== inventory.files.length) {
    throw new Error('Pinned inventory file-count summary is stale.');
  }
  if (inventory.summary?.totalBytes !== totalBytes) {
    throw new Error('Pinned inventory byte-count summary is stale.');
  }
  for (const [classification, count] of Object.entries(classificationCounts)) {
    if (inventory.summary?.byClassification?.[classification] !== count) {
      throw new Error(`Pinned inventory classification summary is stale for ${classification}.`);
    }
  }
  if (inventory.files.length !== expectedIdentity.totalFiles) {
    throw new Error(
      `Pinned inventory must contain exactly ${expectedIdentity.totalFiles} files; received ${
        inventory.files.length
      }`,
    );
  }
  if (totalBytes !== expectedIdentity.totalBytes) {
    throw new Error(
      `Pinned inventory must contain exactly ${expectedIdentity.totalBytes} bytes; received ${
        totalBytes
      }`,
    );
  }
  const semanticSha256 = inventorySemanticDigest(inventory);
  if (semanticSha256 !== expectedIdentity.semanticSha256) {
    throw new Error(
      `Pinned inventory semantic digest mismatch; expected ${expectedIdentity.semanticSha256}, received ${
        semanticSha256
      }`,
    );
  }
  return inventory;
}

function runtimeTreatment(category) {
  return RUNTIME_TREATMENTS[category] || 'application-runtime-source';
}

function evidenceFor({ sourcePath, sourceSha256, implementationPath, implementationSha256,
  materializerPath, materializerSha256, disposition }) {
  return {
    pinnedBlob: `${sourcePath}#sha256=${sourceSha256}`,
    implementationBlob: `${implementationPath}#sha256=${implementationSha256}`,
    materialization: `${materializerPath}#sha256=${materializerSha256};rule=${
      disposition === 'overlaid' ? 'overlay-replaces-pinned-source' : 'copy-pinned-source'
    }`,
    gate: 'scripts/unified-parity-ledger.js#verify',
  };
}

function generatedArtifacts({ workspace, snapshot, materializerPath, materializerSha256 }) {
  const packageLockPath = path.join(snapshot, 'package-lock.json');
  const packageLockProjectPath = projectPath(workspace, packageLockPath, 'dependency lock');
  const packageLock = blobRecord(packageLockPath, 'generated dependency lock');
  const generatorEvidence = `${materializerPath}#sha256=${materializerSha256}`;
  return [
    {
      path: packageLockProjectPath,
      category: 'infra',
      disposition: 'generated-dependency-lock',
      sha256: packageLock.sha256,
      size: packageLock.size,
      runtimePath: '.proxy-max/runtime/unified/package-lock.json',
      evidence: `${generatorEvidence};rule=copy-generated-lock`,
    },
    {
      path: '.proxy-max/runtime/unified/.proxy-max-source.json',
      category: 'infra',
      disposition: 'runtime-generated-manifest',
      kind: 'file',
      evidence: `${generatorEvidence};rule=write-materialization-stamp`,
    },
    {
      path: '.proxy-max/runtime/unified/node_modules',
      category: 'infra',
      disposition: 'runtime-generated-dependencies',
      kind: 'directory',
      evidence: 'scripts/unified-runtime.js;command=unified:install',
    },
    {
      path: '.proxy-max/runtime/unified/.next',
      category: 'infra',
      disposition: 'runtime-generated-build',
      kind: 'directory',
      evidence: 'scripts/unified-runtime.js;command=unified:build',
    },
    {
      path: '.proxy-max/runtime/unified/.next/standalone/.proxy-max-runtime.json',
      category: 'infra',
      disposition: 'runtime-generated-launch-manifest',
      kind: 'file',
      evidence: 'src/runtime/unified-runtime.js;rule=prepareStandalone',
    },
  ];
}

function normalizeOptions(options = {}) {
  const workspace = path.resolve(options.workspace || ROOT);
  const resolveOption = (name) => {
    const value = options[name] || DEFAULT_PATHS[name];
    return path.isAbsolute(value) ? path.resolve(value) : resolveInside(workspace, value, name);
  };
  return {
    workspace,
    inventory: resolveOption('inventory'),
    snapshot: resolveOption('snapshot'),
    overlays: resolveOption('overlays'),
    materializer: resolveOption('materializer'),
    output: resolveOption('output'),
    expectedInventory: options.expectedInventory || PINNED_INVENTORY,
  };
}

function buildLedger(options = {}) {
  const resolved = normalizeOptions(options);
  const inventory = loadInventory(resolved.inventory, resolved.expectedInventory);
  const inventoryProjectPath = projectPath(resolved.workspace, resolved.inventory, 'inventory');
  const snapshotProjectPath = projectPath(resolved.workspace, resolved.snapshot, 'snapshot');
  const overlaysProjectPath = projectPath(resolved.workspace, resolved.overlays, 'overlay root');
  const materializerProjectPath = projectPath(
    resolved.workspace,
    resolved.materializer,
    'materializer',
  );
  const inventoryDigest = blobRecord(resolved.inventory, 'pinned inventory').sha256;
  const materializerDigest = blobRecord(resolved.materializer, 'runtime materializer').sha256;
  const overlayPaths = listFiles(resolved.overlays);
  const overlayPathSet = new Set(overlayPaths);
  const pinnedPaths = new Set(inventory.files.map((entry) => entry.path));
  validateOverlayTopology(overlayPaths, pinnedPaths);
  const snapshotPaths = listSnapshotFiles(resolved.snapshot);
  for (const snapshotPath of snapshotPaths) {
    if (!pinnedPaths.has(snapshotPath)) {
      throw new Error(`Unexpected non-generated snapshot path: ${snapshotPath}`);
    }
  }
  if (snapshotPaths.length !== pinnedPaths.size) {
    const snapshotPathSet = new Set(snapshotPaths);
    const missingPath = inventory.files.find((entry) => !snapshotPathSet.has(entry.path))?.path;
    throw new Error(`Missing pinned snapshot path: ${missingPath || 'unknown'}`);
  }
  const byCategory = {};
  const byDisposition = {};
  const byAdditionCategory = {};

  const entries = inventory.files.map((sourceEntry) => {
    const sourceAbsolutePath = resolveInside(resolved.snapshot, sourceEntry.path, 'snapshot path');
    const actualSource = blobRecord(sourceAbsolutePath, `pinned snapshot file ${sourceEntry.path}`);
    if (actualSource.sha256 !== sourceEntry.sha256 || actualSource.size !== sourceEntry.size) {
      throw new Error(
        `Pinned snapshot mismatch for ${sourceEntry.path}: expected ${sourceEntry.sha256}/${
          sourceEntry.size
        }, received ${actualSource.sha256}/${actualSource.size}`,
      );
    }

    const overlaid = overlayPathSet.has(sourceEntry.path);
    const disposition = overlaid ? 'overlaid' : 'vendored-unchanged';
    const sourcePath = `${snapshotProjectPath}/${sourceEntry.path}`;
    const implementationPath = overlaid
      ? `${overlaysProjectPath}/${sourceEntry.path}`
      : sourcePath;
    const implementation = overlaid
      ? blobRecord(
        resolveInside(resolved.overlays, sourceEntry.path, 'overlay path'),
        `overlay implementation ${sourceEntry.path}`,
      )
      : actualSource;
    increment(byCategory, sourceEntry.classification);
    increment(byDisposition, disposition);

    return {
      path: sourceEntry.path,
      category: sourceEntry.classification,
      disposition,
      runtimeTreatment: runtimeTreatment(sourceEntry.classification),
      source: {
        path: sourcePath,
        sha256: sourceEntry.sha256,
        size: sourceEntry.size,
      },
      implementation: {
        path: implementationPath,
        sha256: implementation.sha256,
        size: implementation.size,
        runtimePath: `.proxy-max/runtime/unified/${sourceEntry.path}`,
      },
      evidence: evidenceFor({
        sourcePath,
        sourceSha256: sourceEntry.sha256,
        implementationPath,
        implementationSha256: implementation.sha256,
        materializerPath: materializerProjectPath,
        materializerSha256: materializerDigest,
        disposition,
      }),
    };
  });

  const additions = overlayPaths
    .filter((relativePath) => !pinnedPaths.has(relativePath))
    .map((relativePath) => {
      const implementationPath = `${overlaysProjectPath}/${relativePath}`;
      const implementation = blobRecord(
        resolveInside(resolved.overlays, relativePath, 'overlay addition'),
        `Proxy-Max addition ${relativePath}`,
      );
      const category = classifyPath(relativePath);
      increment(byAdditionCategory, category);
      return {
        path: relativePath,
        category,
        disposition: 'proxy-max-addition',
        runtimeTreatment: runtimeTreatment(category),
        implementation: {
          path: implementationPath,
          sha256: implementation.sha256,
          size: implementation.size,
          runtimePath: `.proxy-max/runtime/unified/${relativePath}`,
        },
        evidence: {
          implementationBlob: `${implementationPath}#sha256=${implementation.sha256}`,
          materialization: `${materializerProjectPath}#sha256=${
            materializerDigest
          };rule=copy-overlay-addition`,
          gate: 'scripts/unified-parity-ledger.js#verify',
        },
      };
    });

  const overlayReplacementCount = entries.filter((entry) => entry.disposition === 'overlaid').length;
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedBy: 'scripts/unified-parity-ledger.js',
    source: {
      repository: inventory.source.repository,
      tag: inventory.source.tag,
      revision: inventory.source.revision,
      tree: inventory.source.tree,
      inventory: inventoryProjectPath,
      inventorySha256: inventoryDigest,
      inventorySemanticSha256: inventorySemanticDigest(inventory),
    },
    materialization: {
      snapshotRoot: snapshotProjectPath,
      overlayRoot: overlaysProjectPath,
      runtimeRoot: '.proxy-max/runtime/unified',
      materializer: materializerProjectPath,
      materializerSha256: materializerDigest,
      precedence: ['pinned-source', 'generated-dependency-lock', 'proxy-max-overlay'],
    },
    coverage: {
      upstreamPaths: entries.length,
      mappedUpstreamPaths: entries.length,
      unmappedUpstreamPaths: 0,
      staleEntries: 0,
      zeroUnmapped: true,
      zeroStale: true,
      overlayPaths: overlayPaths.length,
      overlayReplacements: overlayReplacementCount,
      overlayAdditions: additions.length,
      materializedSourceFiles: entries.length + additions.length + 1,
      byCategory: sortedCountObject(byCategory),
      byDisposition: sortedCountObject(byDisposition),
      byAdditionCategory: sortedCountObject(byAdditionCategory),
    },
    dispositionPolicy: {
      'vendored-unchanged': 'The verified pinned blob is copied into the runtime tree unchanged.',
      overlaid: 'The verified pinned blob is retained for provenance and a hashed Proxy-Max overlay replaces it during materialization.',
      'proxy-max-addition': 'A hashed Proxy-Max-only file is added to the materialized runtime tree.',
    },
    entries,
    additions,
    generatedArtifacts: generatedArtifacts({
      workspace: resolved.workspace,
      snapshot: resolved.snapshot,
      materializerPath: materializerProjectPath,
      materializerSha256: materializerDigest,
    }),
  };
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function validateCheckedCoverage(checked, expected) {
  const errors = [];
  if (!Array.isArray(checked?.entries)) return ['ledger entries must be an array'];
  if (!Array.isArray(checked?.additions)) return ['ledger additions must be an array'];

  const checkedPaths = new Set();
  for (const entry of checked.entries) {
    if (!entry || typeof entry.path !== 'string') {
      errors.push('ledger contains an upstream entry without a path');
      continue;
    }
    if (checkedPaths.has(entry.path)) errors.push(`duplicate upstream ledger entry: ${entry.path}`);
    checkedPaths.add(entry.path);
    if (!UPSTREAM_DISPOSITIONS.has(entry.disposition)) {
      errors.push(`invalid disposition for ${entry.path}: ${entry.disposition}`);
    }
    if (!entry.category || !entry.implementation?.path || !entry.evidence) {
      errors.push(`incomplete implementation evidence for ${entry.path}`);
    }
  }
  const expectedPaths = new Set(expected.entries.map((entry) => entry.path));
  for (const expectedPath of expectedPaths) {
    if (!checkedPaths.has(expectedPath)) errors.push(`unmapped upstream path: ${expectedPath}`);
  }
  for (const checkedPath of checkedPaths) {
    if (!expectedPaths.has(checkedPath)) errors.push(`stale upstream ledger entry: ${checkedPath}`);
  }

  const checkedAdditions = new Set();
  for (const addition of checked.additions) {
    if (!addition || typeof addition.path !== 'string') {
      errors.push('ledger contains an overlay addition without a path');
      continue;
    }
    if (checkedAdditions.has(addition.path)) errors.push(`duplicate overlay addition: ${addition.path}`);
    checkedAdditions.add(addition.path);
    if (addition.disposition !== 'proxy-max-addition') {
      errors.push(`invalid overlay-addition disposition for ${addition.path}`);
    }
  }
  const expectedAdditions = new Set(expected.additions.map((entry) => entry.path));
  for (const expectedPath of expectedAdditions) {
    if (!checkedAdditions.has(expectedPath)) errors.push(`unmapped overlay addition: ${expectedPath}`);
  }
  for (const checkedPath of checkedAdditions) {
    if (!expectedAdditions.has(checkedPath)) errors.push(`stale overlay-addition entry: ${checkedPath}`);
  }
  return errors;
}

function appendStaleDetails(errors, checked, expected) {
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  if (!same(checked.source, expected.source)) errors.push('stale ledger source metadata');
  if (!same(checked.materialization, expected.materialization)) {
    errors.push('stale ledger materialization metadata');
  }
  if (!same(checked.coverage, expected.coverage)) errors.push('stale ledger coverage summary');

  const checkedEntries = new Map(
    Array.isArray(checked.entries)
      ? checked.entries.filter((entry) => entry && typeof entry.path === 'string')
        .map((entry) => [entry.path, entry])
      : [],
  );
  const checkedAdditions = new Map(
    Array.isArray(checked.additions)
      ? checked.additions.filter((entry) => entry && typeof entry.path === 'string')
        .map((entry) => [entry.path, entry])
      : [],
  );
  let detailCount = 0;
  for (const entry of expected.entries) {
    const checkedEntry = checkedEntries.get(entry.path);
    if (checkedEntry && !same(checkedEntry, entry) && detailCount < 20) {
      errors.push(`stale upstream mapping: ${entry.path}`);
      detailCount += 1;
    }
  }
  for (const addition of expected.additions) {
    const checkedAddition = checkedAdditions.get(addition.path);
    if (checkedAddition && !same(checkedAddition, addition) && detailCount < 20) {
      errors.push(`stale overlay-addition mapping: ${addition.path}`);
      detailCount += 1;
    }
  }
  if (!same(checked.generatedArtifacts, expected.generatedArtifacts)) {
    errors.push('stale generated-artifact mapping');
  }
}

function generateLedger(options = {}) {
  const resolved = normalizeOptions(options);
  const ledger = buildLedger(resolved);
  fs.mkdirSync(path.dirname(resolved.output), { recursive: true });
  const temporaryOutput = `${resolved.output}.tmp-${process.pid}-${
    crypto.randomBytes(6).toString('hex')
  }`;
  try {
    fs.writeFileSync(temporaryOutput, canonicalJson(ledger), { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporaryOutput, resolved.output);
  } finally {
    try { fs.unlinkSync(temporaryOutput); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return ledger;
}

function verifyLedger(options = {}) {
  const resolved = normalizeOptions(options);
  let checked;
  try {
    checked = JSON.parse(fs.readFileSync(resolved.output, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read parity ledger ${resolved.output}: ${error.message}`);
  }
  const expected = buildLedger(resolved);
  const errors = validateCheckedCoverage(checked, expected);
  if (canonicalJson(checked) !== canonicalJson(expected)) {
    appendStaleDetails(errors, checked, expected);
    errors.push('ledger content or ordering is stale; run `npm run unified:parity:generate`');
  }
  if (errors.length > 0) {
    throw new Error(`unified parity gate failed:\n${errors.slice(0, 50).join('\n')}`);
  }
  return expected;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/unified-parity-ledger.js generate [options]',
    '  node scripts/unified-parity-ledger.js verify [options]',
    '',
    'Options:',
    '  --workspace PATH',
    '  --inventory PATH',
    '  --snapshot PATH',
    '  --overlays PATH',
    '  --materializer PATH',
    '  --output PATH',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {};
  let command = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    if (!command && (argument === 'generate' || argument === 'verify')) {
      command = argument;
      continue;
    }
    const equalsIndex = argument.indexOf('=');
    const key = equalsIndex === -1 ? argument : argument.slice(0, equalsIndex);
    const value = equalsIndex === -1 ? argv[++index] : argument.slice(equalsIndex + 1);
    if (!/^--(workspace|inventory|snapshot|overlays|materializer|output)$/u.test(key)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    options[key.slice(2)] = value;
  }
  if (!options.help && !command) throw new Error('Expected command: generate or verify');
  return { command, options };
}

function main() {
  try {
    const parsed = parseArgs(process.argv.slice(2));
    if (parsed.options.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }
    const ledger = parsed.command === 'generate'
      ? generateLedger(parsed.options)
      : verifyLedger(parsed.options);
    process.stdout.write(
      `PASS: ${parsed.command} ${ledger.coverage.mappedUpstreamPaths}/${
        ledger.coverage.upstreamPaths
      } upstream paths; ${ledger.coverage.overlayReplacements} overlays; ${
        ledger.coverage.overlayAdditions
      } additions; 0 unmapped; 0 stale\n`,
    );
  } catch (error) {
    process.stderr.write(`FAIL: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  DEFAULT_PATHS,
  DISPOSITIONS,
  SCHEMA_VERSION,
  PINNED_INVENTORY,
  buildLedger,
  canonicalJson,
  generateLedger,
  inventorySemanticDigest,
  listFiles,
  listSnapshotFiles,
  loadInventory,
  normalizeOptions,
  parseArgs,
  verifyLedger,
  validateOverlayTopology,
};
