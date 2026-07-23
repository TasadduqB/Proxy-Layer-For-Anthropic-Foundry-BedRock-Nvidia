'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  listFiles,
  loadPinnedFiles,
  materializeRuntimeSource,
  normalizeRelativePath,
} = require('./src/runtime/unified-source');

assert.strictEqual(normalizeRelativePath('src/app.js'), 'src/app.js');
for (const unsafe of ['', '../escape', '/absolute', 'src/../escape', '.next/server.js', 'node_modules/x.js', '.git/config']) {
  assert.throws(() => normalizeRelativePath(unsafe));
}
assert.strictEqual(loadPinnedFiles().files.length, 1342);

const overlayPackage = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'overlays', 'unified', 'package.json'),
  'utf8',
));
const dependencyLock = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'upstream', 'router-core', 'package-lock.json'),
  'utf8',
));
const rootPackage = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
assert.strictEqual(overlayPackage.version, rootPackage.version);
assert.strictEqual(dependencyLock.version, overlayPackage.version);
assert.strictEqual(dependencyLock.packages[''].version, overlayPackage.version);
assert.strictEqual(overlayPackage.engines.node, '>=20.19.0');
assert.strictEqual(overlayPackage.devDependencies.vitest, '^4.0.0');
assert.strictEqual(overlayPackage.overrides.dompurify, '3.4.12');
assert.strictEqual(overlayPackage.overrides.postcss, '$postcss');
assert.strictEqual(dependencyLock.packages['node_modules/dompurify'].version, '3.4.12');
assert.strictEqual(dependencyLock.packages['node_modules/postcss'].version, '8.5.21');
assert.strictEqual(dependencyLock.packages['node_modules/next/node_modules/postcss'], undefined);
assert.match(dependencyLock.packages['node_modules/vitest'].version, /^4\./);
assert.match(
  fs.readFileSync(path.join(__dirname, 'scripts', 'test-unified.js'), 'utf8'),
  /'--config',\s*config/,
);

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-max-source-test-'));
try {
  const overlay = path.join(temporaryRoot, 'overlay');
  const runtime = path.join(temporaryRoot, 'runtime');
  fs.mkdirSync(path.join(overlay, 'src'), { recursive: true });
  fs.writeFileSync(path.join(overlay, 'src', 'overlay-fixture.js'), 'module.exports = 42;\n');
  assert.deepStrictEqual(listFiles(overlay), ['src/overlay-fixture.js']);

  const first = materializeRuntimeSource({ runtimeDir: runtime, overlayDir: overlay });
  assert.strictEqual(first.unchanged, false);
  assert.strictEqual(first.overlayFiles.length, 1);
  assert(fs.existsSync(path.join(runtime, 'src', 'overlay-fixture.js')));
  assert(fs.existsSync(path.join(runtime, 'package.json')));
  assert(fs.existsSync(path.join(runtime, 'package-lock.json')));

  const second = materializeRuntimeSource({ runtimeDir: runtime, overlayDir: overlay });
  assert.strictEqual(second.unchanged, true);

  fs.unlinkSync(path.join(overlay, 'src', 'overlay-fixture.js'));
  const third = materializeRuntimeSource({ runtimeDir: runtime, overlayDir: overlay });
  assert.strictEqual(third.unchanged, false);
  assert(!fs.existsSync(path.join(runtime, 'src', 'overlay-fixture.js')));
  console.log('unified source materialization tests passed');
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
