#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  EXPECTED_REVISION,
  EXPECTED_TAG,
  classifyPath,
  generateManifest,
} = require('./generate-unified-parity');

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const equalsIndex = argument.indexOf('=');
    const key = equalsIndex === -1 ? argument : argument.slice(0, equalsIndex);
    const value = equalsIndex === -1 ? argv[++index] : argument.slice(equalsIndex + 1);
    if (key !== '--upstream' && key !== '--manifest') {
      throw new Error(`Unknown argument: ${argument}`);
    }
    if (!value) throw new Error(`Missing value for ${key}`);
    options[key.slice(2)] = value;
  }
  if (!options.upstream || !options.manifest) {
    throw new Error('Both --upstream and --manifest are required.');
  }
  return options;
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function gitTrackedPaths(upstream) {
  return execFileSync('git', ['-C', upstream, 'ls-files', '-z'])
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .sort(compareStrings);
}

function verifyClassificationExamples() {
  const examples = new Map([
    ['src/app/api/v1/messages/route.js', 'api-route'],
    ['src/app/(dashboard)/dashboard/page.js', 'ui-page/component'],
    ['open-sse/providers/registry/anthropic.js', 'provider'],
    ['open-sse/executors/azure.js', 'executor'],
    ['open-sse/translator/request/claude-to-openai.js', 'translator'],
    ['tests/unit/model-routing.test.js', 'test'],
    ['public/i18n/literals/en.json', 'docs/i18n'],
    ['skills/unified/SKILL.md', 'skill'],
    ['public/providers/openai.png', 'asset'],
    ['cli/src/cli/terminalUI.js', 'cli'],
    ['docker-compose.yml', 'infra'],
    ['open-sse/handlers/chatCore.js', 'other'],
  ]);
  for (const [filePath, expected] of examples) {
    assert.equal(classifyPath(filePath), expected, filePath);
  }
}

function verifyManifestShape(manifest, trackedPaths) {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.source.tag, EXPECTED_TAG);
  assert.equal(manifest.source.revision, EXPECTED_REVISION);
  assert.equal(manifest.summary.totalFiles, trackedPaths.length);
  assert.equal(manifest.summary.totalFiles, manifest.files.length);
  assert.deepEqual(
    manifest.files.map((entry) => entry.path),
    trackedPaths,
    'manifest paths must equal sorted git ls-files exactly',
  );

  const uniquePaths = new Set();
  let totalBytes = 0;
  const statusCounts = new Map();
  const classificationCounts = new Map();
  for (const entry of manifest.files) {
    assert(!uniquePaths.has(entry.path), `duplicate path: ${entry.path}`);
    uniquePaths.add(entry.path);
    assert.match(entry.sha256, /^[0-9a-f]{64}$/u, entry.path);
    assert(Number.isSafeInteger(entry.size) && entry.size >= 0, entry.path);
    assert.equal(entry.classification, classifyPath(entry.path), entry.path);
    assert.equal(typeof entry.status, 'string', entry.path);
    totalBytes += entry.size;
    statusCounts.set(entry.status, (statusCounts.get(entry.status) || 0) + 1);
    classificationCounts.set(
      entry.classification,
      (classificationCounts.get(entry.classification) || 0) + 1,
    );
  }

  assert.equal(manifest.summary.totalBytes, totalBytes);
  for (const [status, count] of statusCounts) {
    assert.equal(manifest.summary.byStatus[status], count, status);
  }
  for (const [classification, count] of classificationCounts) {
    assert.equal(manifest.summary.byClassification[classification], count, classification);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const upstream = path.resolve(options.upstream);
  const manifestPath = path.resolve(options.manifest);
  const trackedPaths = gitTrackedPaths(upstream);
  const checkedIn = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  verifyClassificationExamples();
  verifyManifestShape(checkedIn, trackedPaths);

  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-max-parity-'));
  const tempManifest = path.join(tempDirectory, 'manifest.json');
  try {
    const first = generateManifest({ upstream, output: tempManifest });
    verifyManifestShape(first, trackedPaths);
    assert.deepEqual(
      checkedIn.files.map(({ path: filePath, sha256, size, classification }) => ({
        path: filePath,
        sha256,
        size,
        classification,
      })),
      first.files.map(({ path: filePath, sha256, size, classification }) => ({
        path: filePath,
        sha256,
        size,
        classification,
      })),
      'checked-in blob hashes, sizes, and classifications must match the tagged tree',
    );

    const edited = JSON.parse(fs.readFileSync(tempManifest, 'utf8'));
    edited.files[0].status = 'implemented';
    edited.files[0].target = ['src/parity/example.js', 'ui/parity/example.js'];
    edited.files[0].notes = { evidence: 'standalone preservation test', owner: 'test' };
    fs.writeFileSync(tempManifest, `${JSON.stringify(edited, null, 2)}\n`, 'utf8');

    const preserved = generateManifest({ upstream, output: tempManifest });
    assert.equal(preserved.files[0].status, 'implemented');
    assert.deepEqual(preserved.files[0].target, [
      'src/parity/example.js',
      'ui/parity/example.js',
    ]);
    assert.deepEqual(preserved.files[0].notes, {
      evidence: 'standalone preservation test',
      owner: 'test',
    });

    const before = fs.readFileSync(tempManifest);
    generateManifest({ upstream, output: tempManifest });
    const after = fs.readFileSync(tempManifest);
    assert.deepEqual(after, before, 'regeneration must be byte-for-byte deterministic');
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }

  process.stdout.write(
    `PASS: ${trackedPaths.length} files, exact git inventory, mapping preservation, deterministic output\n`,
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(`FAIL: ${error.stack || error.message}\n`);
  process.exitCode = 1;
}
