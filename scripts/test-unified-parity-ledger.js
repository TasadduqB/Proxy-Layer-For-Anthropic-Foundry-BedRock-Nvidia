#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  CLASSIFICATIONS,
  EXPECTED_REVISION,
  EXPECTED_TAG,
  classifyPath,
} = require('./generate-unified-parity');
const {
  buildLedger,
  canonicalJson,
  generateLedger,
  inventorySemanticDigest,
  verifyLedger,
} = require('./unified-parity-ledger');

function digest(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function writeFile(root, relativePath, content) {
  const filePath = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

function createFixture() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-max-ledger-test-'));
  const sourceFiles = new Map([
    ['README.md', '# Fixture\n'],
    ['src/app/api/ping/route.js', 'export function GET() { return new Response("pong"); }\n'],
  ]);
  for (const [relativePath, content] of sourceFiles) {
    writeFile(workspace, `upstream/router-core/${relativePath}`, content);
  }
  writeFile(workspace, 'upstream/router-core/package-lock.json', '{"lockfileVersion":3}\n');
  writeFile(
    workspace,
    'overlays/unified/src/app/api/ping/route.js',
    'export function GET() { return new Response("proxy-max"); }\n',
  );
  writeFile(
    workspace,
    'overlays/unified/tests/unit/proxy-max-added.test.js',
    'export const covered = true;\n',
  );
  writeFile(workspace, 'src/runtime/unified-source.js', 'module.exports = { overlayWins: true };\n');

  const files = [...sourceFiles.entries()]
    .map(([relativePath, content]) => ({
      path: relativePath,
      sha256: digest(Buffer.from(content)),
      size: Buffer.byteLength(content),
      classification: classifyPath(relativePath),
      status: 'unmapped',
      target: null,
      notes: null,
    }))
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const totalBytes = files.reduce((sum, entry) => sum + entry.size, 0);
  const byClassification = Object.fromEntries(
    CLASSIFICATIONS.map((classification) => [classification, 0]),
  );
  for (const entry of files) byClassification[entry.classification] += 1;
  const inventory = {
    schemaVersion: 1,
    classificationRulesVersion: 1,
    source: {
      repository: 'https://github.com/decolua/9router',
      tag: EXPECTED_TAG,
      revision: EXPECTED_REVISION,
      tree: 'fixture-tree',
    },
    summary: { totalFiles: files.length, totalBytes, byClassification },
    files,
  };
  writeFile(
    workspace,
    'docs/parity/upstream-v0.5.40.json',
    `${JSON.stringify(inventory, null, 2)}\n`,
  );

  return {
    workspace,
    options: {
      workspace,
      expectedInventory: {
        ...inventory.source,
        totalFiles: files.length,
        totalBytes,
        semanticSha256: inventorySemanticDigest(inventory),
      },
    },
    output: path.join(workspace, 'docs/parity/upstream-v0.5.40.ledger.json'),
  };
}

function withFixture(callback) {
  const fixture = createFixture();
  try {
    callback(fixture);
  } finally {
    fs.rmSync(fixture.workspace, { recursive: true, force: true });
  }
}

function verifyExhaustiveMapping() {
  withFixture(({ options }) => {
    const ledger = buildLedger(options);
    assert.equal(ledger.coverage.upstreamPaths, 2);
    assert.equal(ledger.coverage.mappedUpstreamPaths, 2);
    assert.equal(ledger.coverage.unmappedUpstreamPaths, 0);
    assert.equal(ledger.coverage.staleEntries, 0);
    assert.equal(ledger.coverage.overlayPaths, 2);
    assert.equal(ledger.coverage.overlayReplacements, 1);
    assert.equal(ledger.coverage.overlayAdditions, 1);
    assert.equal(ledger.coverage.materializedSourceFiles, 4);
    assert.deepEqual(ledger.coverage.byAdditionCategory, { test: 1 });

    const readme = ledger.entries.find((entry) => entry.path === 'README.md');
    assert.equal(readme.category, 'docs/i18n');
    assert.equal(readme.disposition, 'vendored-unchanged');
    assert.equal(readme.runtimeTreatment, 'documentation-or-localization-source');
    assert.match(readme.evidence.pinnedBlob, /^upstream\/router-core\/README\.md#sha256=/u);

    const route = ledger.entries.find((entry) => entry.path.endsWith('/route.js'));
    assert.equal(route.category, 'api-route');
    assert.equal(route.disposition, 'overlaid');
    assert.equal(route.implementation.path, 'overlays/unified/src/app/api/ping/route.js');
    assert.match(route.evidence.materialization, /rule=overlay-replaces-pinned-source$/u);

    assert.equal(ledger.additions[0].path, 'tests/unit/proxy-max-added.test.js');
    assert.equal(ledger.additions[0].disposition, 'proxy-max-addition');
    assert.equal(ledger.additions[0].category, 'test');
    assert.equal(ledger.generatedArtifacts.length, 5);
  });
}

function verifyDeterminismAndGate() {
  withFixture(({ options, output }) => {
    generateLedger(options);
    const first = fs.readFileSync(output);
    generateLedger(options);
    const second = fs.readFileSync(output);
    assert.deepEqual(second, first, 'generation must be byte-for-byte deterministic');
    const verified = verifyLedger(options);
    assert.equal(verified.coverage.zeroUnmapped, true);
    assert.equal(verified.coverage.zeroStale, true);
  });
}

function verifyMissingAndStaleRowsFail() {
  withFixture(({ options, output }) => {
    generateLedger(options);
    const ledger = JSON.parse(fs.readFileSync(output, 'utf8'));
    ledger.entries.pop();
    fs.writeFileSync(output, canonicalJson(ledger));
    assert.throws(() => verifyLedger(options), /unmapped upstream path/u);
  });

  withFixture(({ options, output }) => {
    generateLedger(options);
    const ledger = JSON.parse(fs.readFileSync(output, 'utf8'));
    ledger.entries.push({
      path: 'removed-upstream-file.js',
      category: 'other',
      disposition: 'vendored-unchanged',
      implementation: { path: 'upstream/router-core/removed-upstream-file.js' },
      evidence: { gate: 'invalid' },
    });
    fs.writeFileSync(output, canonicalJson(ledger));
    assert.throws(() => verifyLedger(options), /stale upstream ledger entry/u);
  });
}

function verifyChangedInputsFail() {
  withFixture(({ workspace, options }) => {
    generateLedger(options);
    fs.appendFileSync(
      path.join(workspace, 'overlays/unified/src/app/api/ping/route.js'),
      '// changed\n',
    );
    assert.throws(() => verifyLedger(options), /ledger content or ordering is stale/u);
  });

  withFixture(({ workspace, options }) => {
    generateLedger(options);
    writeFile(workspace, 'overlays/unified/src/lib/new-addition.js', 'export default true;\n');
    assert.throws(() => verifyLedger(options), /unmapped overlay addition/u);
  });

  withFixture(({ workspace, options }) => {
    writeFile(workspace, 'overlays/unified/.proxy-max-source.json', '{}\n');
    assert.throws(
      () => buildLedger(options),
      /Overlay collides with a generated runtime artifact/u,
    );
  });

  withFixture(({ workspace, options }) => {
    generateLedger(options);
    fs.appendFileSync(path.join(workspace, 'upstream/router-core/README.md'), 'corrupt\n');
    assert.throws(() => verifyLedger(options), /Pinned snapshot mismatch for README\.md/u);
  });

  withFixture(({ workspace, options }) => {
    generateLedger(options);
    writeFile(workspace, 'upstream/router-core/untracked-source.js', 'unexpected\n');
    assert.throws(() => verifyLedger(options), /Unexpected non-generated snapshot path/u);
  });

  withFixture(({ workspace, options }) => {
    generateLedger(options);
    fs.appendFileSync(path.join(workspace, 'upstream/router-core/package-lock.json'), ' ');
    assert.throws(() => verifyLedger(options), /ledger content or ordering is stale/u);
  });
}

try {
  verifyExhaustiveMapping();
  verifyDeterminismAndGate();
  verifyMissingAndStaleRowsFail();
  verifyChangedInputsFail();
  process.stdout.write(
    'PASS: exhaustive mapping, separate additions, deterministic output, and stale-input rejection\n',
  );
} catch (error) {
  process.stderr.write(`FAIL: ${error.stack || error.message}\n`);
  process.exitCode = 1;
}
