'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  assertSupportedNode,
  buildStandaloneEnv,
  buildRuntimeEnv,
  compareVersions,
  parsePort,
  parseVersion,
  prepareStandalone,
  resolveDataDir,
  runtimePaths,
} = require('./src/runtime/unified-runtime');
const { normalizeMode } = require('./src/runtime/supervisor');

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-max-runtime-test-'));
try {
  assert.deepStrictEqual(parseVersion('v20.9.0'), [20, 9, 0]);
  assert.deepStrictEqual(parseVersion('25.1.2-beta.1'), [25, 1, 2]);
  assert.strictEqual(parseVersion('bad'), null);
  assert.strictEqual(compareVersions([20, 19, 0], [20, 19, 0]), 0);
  assert.strictEqual(compareVersions([22, 0, 0], [20, 19, 0]), 1);
  assert.strictEqual(compareVersions([20, 18, 1], [20, 19, 0]), -1);
  assert.throws(() => assertSupportedNode('20.18.1'), /requires Node >= 20\.19\.0/);
  assert.doesNotThrow(() => assertSupportedNode('20.19.0'));

  assert.strictEqual(parsePort(undefined, 20128), 20128);
  assert.strictEqual(parsePort('9876', 20128), 9876);
  for (const bad of ['abc', '2.5', 0, 65536]) assert.throws(() => parsePort(bad), /Invalid unified port/);

  assert.strictEqual(normalizeMode(), 'unified');
  assert.strictEqual(normalizeMode('next'), 'unified');
  assert.strictEqual(normalizeMode('full'), 'unified');
  assert.strictEqual(normalizeMode('parallel'), 'parallel');
  assert.throws(() => normalizeMode('mystery'), /Invalid PROXY_MAX_RUNTIME/);

  const launcherSource = fs.readFileSync(path.join(__dirname, 'src', 'launch.js'), 'utf8');
  assert.match(launcherSource, /runtime['"],\s*['"]supervisor\.js/);
  assert.doesNotMatch(launcherSource, /path\.resolve\(__dirname,\s*['"]server\.js/);

  const isolatedData = path.join(temporaryRoot, 'base-data');
  assert.strictEqual(
    resolveDataDir({ PROXY_MAX_DATA_DIR: isolatedData }),
    path.join(isolatedData, 'unified'),
  );
  assert.strictEqual(
    resolveDataDir({ PROXY_MAX_UNIFIED_DATA_DIR: path.join(temporaryRoot, 'explicit') }),
    path.join(temporaryRoot, 'explicit'),
  );
  const runtimeEnv = buildRuntimeEnv({
    env: { PROXY_MAX_DATA_DIR: isolatedData },
    host: '127.0.0.1',
    port: 34567,
  });
  assert.strictEqual(runtimeEnv.DATA_DIR, path.join(isolatedData, 'unified'));
  assert.strictEqual(runtimeEnv.PORT, '34567');
  assert.strictEqual(runtimeEnv.HOSTNAME, '127.0.0.1');
  assert.strictEqual(runtimeEnv.PROXY_MAX_SOURCE_ROOT, path.resolve(__dirname));
  assert.strictEqual(runtimeEnv.PROXY_MAX_UNIFIED_BUILD_DATA_ROOT, undefined);
  assert.strictEqual(fs.statSync(runtimeEnv.DATA_DIR).mode & 0o777, 0o700);

  const staleBuildRootRuntimeEnv = buildRuntimeEnv({
    env: {
      PROXY_MAX_DATA_DIR: isolatedData,
      PROXY_MAX_UNIFIED_BUILD_DATA_ROOT: path.join(temporaryRoot, 'stale-build-root'),
    },
  });
  assert.strictEqual(staleBuildRootRuntimeEnv.DATA_DIR, path.join(isolatedData, 'unified'));
  assert.strictEqual(staleBuildRootRuntimeEnv.PROXY_MAX_UNIFIED_BUILD_DATA_ROOT, undefined);

  const buildDataRoot = path.join(temporaryRoot, 'build-data');
  const buildEnv = buildStandaloneEnv({ SENTINEL: 'preserved' }, buildDataRoot);
  assert.strictEqual(buildEnv.DATA_DIR, buildDataRoot);
  assert.strictEqual(buildEnv.PROXY_MAX_UNIFIED_BUILD_DATA_ROOT, buildDataRoot);
  assert.strictEqual(buildEnv.SENTINEL, 'preserved');

  const fixture = path.join(temporaryRoot, 'upstream');
  const fixturePaths = runtimePaths(fixture);
  fs.mkdirSync(path.dirname(fixturePaths.serverPath), { recursive: true });
  fs.mkdirSync(fixturePaths.staticSource, { recursive: true });
  fs.mkdirSync(fixturePaths.publicSource, { recursive: true });
  fs.writeFileSync(fixturePaths.serverPath, 'module.exports = {};\n');
  fs.writeFileSync(fixturePaths.buildIdPath, 'fixture-build\n');
  fs.writeFileSync(fixturePaths.customServerSource, 'require("./server.js");\n');
  fs.writeFileSync(path.join(fixturePaths.staticSource, 'asset.js'), 'asset\n');
  fs.writeFileSync(path.join(fixturePaths.publicSource, 'icon.txt'), 'icon\n');

  const prepared = prepareStandalone({ upstreamDir: fixture });
  assert.strictEqual(prepared.buildId, 'fixture-build');
  assert.strictEqual(fs.readFileSync(prepared.customServerPath, 'utf8'), 'require("./server.js");\n');
  assert.strictEqual(fs.readFileSync(path.join(prepared.staticDestination, 'asset.js'), 'utf8'), 'asset\n');
  assert.strictEqual(fs.readFileSync(path.join(prepared.publicDestination, 'icon.txt'), 'utf8'), 'icon\n');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(prepared.standaloneDir, '.proxy-max-runtime.json'))).launcher, 'custom-server.js');

  console.log('unified runtime adapter tests passed');
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
