'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = __dirname;
const PACKAGE = require('./package.json');
const FULL_SMOKE = process.argv.includes('--full') || process.env.PROXY_MAX_PACKAGE_FULL_TEST === '1';
const MAX_PACKED_BYTES = 25 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 80 * 1024 * 1024;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    env: options.env || process.env,
    encoding: 'utf8',
    maxBuffer: options.maxBuffer || 32 * 1024 * 1024,
    timeout: options.timeout || 120000,
    shell: false,
  });
  if (result.error) throw result.error;
  if (options.allowFailure !== true && result.status !== 0) {
    throw new Error([
      `${command} ${args.join(' ')} failed with status ${result.status}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  return result;
}

function npmCommand(args, options = {}) {
  const env = { ...(options.env || process.env) };
  delete env.npm_config_dry_run;
  delete env.npm_config_dryRun;
  const npmExecPath = process.env.npm_execpath && fs.existsSync(process.env.npm_execpath)
    ? process.env.npm_execpath
    : null;
  return npmExecPath
    ? run(process.execPath, [npmExecPath, ...args], { ...options, env })
    : run(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { ...options, env });
}

function installedBin(prefix) {
  return process.platform === 'win32'
    ? path.join(prefix, 'node_modules', '.bin', 'proxy-max.cmd')
    : path.join(prefix, 'node_modules', '.bin', 'proxy-max');
}

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-max-npm-package-'));
try {
  const artifacts = path.join(temporaryRoot, 'artifacts');
  const installPrefix = path.join(temporaryRoot, 'install');
  const runtimeDir = path.join(temporaryRoot, 'runtime');
  const dataDir = path.join(temporaryRoot, 'data');
  fs.mkdirSync(artifacts, { recursive: true });

  const packed = npmCommand(['pack', '--json', '--pack-destination', artifacts], {
    timeout: 180000,
  });
  const report = JSON.parse(packed.stdout);
  assert(Array.isArray(report) && report.length === 1, 'npm pack must produce exactly one package');
  const archive = report[0];
  assert.strictEqual(archive.name, PACKAGE.name);
  assert.strictEqual(archive.version, PACKAGE.version);
  assert(archive.size <= MAX_PACKED_BYTES, `packed package is too large: ${archive.size}`);
  assert(archive.unpackedSize <= MAX_UNPACKED_BYTES, `unpacked package is too large: ${archive.unpackedSize}`);

  const files = new Set(archive.files.map((entry) => entry.path));
  for (const required of [
    'package.json',
    'src/npm-cli.js',
    'src/runtime/unified-runtime.js',
    'src/runtime/unified-source.js',
    'scripts/reset-unified-password.js',
    'npm-runtime/package.json',
    'npm-runtime/package-lock.json',
    'npm-runtime/custom-server.js',
    'npm-runtime/src/app/api/health/route.js',
  ]) {
    assert(files.has(required), `npm package is missing ${required}`);
  }
  for (const file of files) {
    assert(!file.startsWith('.proxy-max/'), `generated runtime leaked into package: ${file}`);
    assert(
      file.endsWith('/.env.example') || !/(^|\/)\.env($|\.)/.test(file),
      `environment file leaked into package: ${file}`,
    );
    assert(!/^(data|logs)\//.test(file), `runtime data leaked into package: ${file}`);
  }

  const tarball = path.join(artifacts, archive.filename);
  assert(fs.existsSync(tarball), 'npm pack did not create the reported tarball');
  npmCommand([
    'install',
    '--prefix', installPrefix,
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    tarball,
  ], { timeout: 180000 });

  const installedPackage = require(path.join(installPrefix, 'node_modules', PACKAGE.name, 'package.json'));
  assert.strictEqual(installedPackage.version, PACKAGE.version);
  assert.strictEqual(installedPackage.bin['proxy-max'], 'src/npm-cli.js');

  const bin = installedBin(installPrefix);
  assert(fs.existsSync(bin), 'npm did not create the proxy-max executable');
  const version = run(bin, ['--version'], { timeout: 30000 });
  assert.strictEqual(version.stdout.trim(), PACKAGE.version);

  const isolatedEnv = {
    ...process.env,
    PROXY_MAX_PACKAGE_RUNTIME_DIR: runtimeDir,
    PROXY_MAX_UNIFIED_DATA_DIR: dataDir,
  };
  const initialDoctor = run(bin, ['doctor'], {
    env: isolatedEnv,
    allowFailure: true,
    timeout: 30000,
  });
  assert.notStrictEqual(initialDoctor.status, 0, 'a fresh package runtime must not report ready before preparation');
  assert.match(initialDoctor.stdout, /"ready": false/);

  if (FULL_SMOKE) {
    run(bin, ['prepare'], { env: isolatedEnv, timeout: 10 * 60 * 1000 });
    const preparedDoctor = run(bin, ['doctor'], { env: isolatedEnv, timeout: 30000 });
    assert.match(preparedDoctor.stdout, /"ready": true/);
    const smoke = run(bin, ['smoke'], { env: isolatedEnv, timeout: 3 * 60 * 1000 });
    assert.match(smoke.stdout, /"ok": true/);
  }

  console.log(JSON.stringify({
    ok: true,
    package: `${PACKAGE.name}@${PACKAGE.version}`,
    packedBytes: archive.size,
    unpackedBytes: archive.unpackedSize,
    entryCount: archive.entryCount,
    installedBin: true,
    fullSmoke: FULL_SMOKE,
  }, null, 2));
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
