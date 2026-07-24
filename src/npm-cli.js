#!/usr/bin/env node
'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const {
  assertSupportedNode,
  buildStandalone,
  installDependencies,
  parsePort,
  resolveDataDir,
  runtimeStatus,
  smokeStandalone,
  spawnUnified,
} = require('./runtime/unified-runtime');
const { materializeRuntimeSource } = require('./runtime/unified-source');
const pkg = require('../package.json');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8787;
const BUNDLED_RUNTIME_DIR = path.resolve(__dirname, '..', 'npm-runtime');

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function installBundledRuntimeSource(sourceDir, projectDir) {
  const sourceStamp = readJson(path.join(sourceDir, '.proxy-max-source.json'));
  if (!sourceStamp?.digest || !Array.isArray(sourceStamp.files)) {
    throw new Error('The npm package does not contain a valid Proxy Max runtime');
  }
  const targetStamp = readJson(path.join(projectDir, '.proxy-max-source.json'));
  const complete = targetStamp?.digest === sourceStamp.digest
    && sourceStamp.files.every((file) => fs.existsSync(path.join(projectDir, ...file.split('/'))));
  if (complete) return { ...sourceStamp, runtimeDir: projectDir, unchanged: true };

  fs.mkdirSync(projectDir, { recursive: true, mode: 0o700 });
  fs.cpSync(sourceDir, projectDir, {
    recursive: true,
    force: true,
    preserveTimestamps: true,
  });
  return { ...sourceStamp, runtimeDir: projectDir, unchanged: false };
}

function packageRuntimeDir(env = process.env) {
  if (env.PROXY_MAX_PACKAGE_RUNTIME_DIR) {
    return path.resolve(env.PROXY_MAX_PACKAGE_RUNTIME_DIR);
  }
  const cacheRoot = env.PROXY_MAX_RUNTIME_CACHE_DIR
    ? path.resolve(env.PROXY_MAX_RUNTIME_CACHE_DIR)
    : path.join(os.homedir(), '.proxy-max', 'runtime', 'npm');
  return path.join(cacheRoot, pkg.version);
}

function packageRuntimeStatus(options = {}) {
  const env = options.env || process.env;
  return runtimeStatus({
    projectDir: options.projectDir || packageRuntimeDir(env),
    env,
    nodeVersion: options.nodeVersion,
    host: String(env.PROXY_MAX_UNIFIED_HOST || DEFAULT_HOST).trim() || DEFAULT_HOST,
    port: parsePort(env.PROXY_MAX_UNIFIED_PORT || env.PORT, DEFAULT_PORT),
  });
}

function preparePackageRuntime(options = {}) {
  const env = options.env || process.env;
  assertSupportedNode(options.nodeVersion);
  const projectDir = options.projectDir || packageRuntimeDir(env);
  const bundled = fs.existsSync(path.join(BUNDLED_RUNTIME_DIR, '.proxy-max-source.json'));
  const materialized = bundled
    ? installBundledRuntimeSource(BUNDLED_RUNTIME_DIR, projectDir)
    : materializeRuntimeSource({ runtimeDir: projectDir });
  let status = packageRuntimeStatus({ env, projectDir, nodeVersion: options.nodeVersion });

  if (!status.dependenciesPresent || !materialized.unchanged) {
    console.log(`[proxy-max] Installing locked application dependencies in ${projectDir}`);
    installDependencies({
      projectDir,
      env,
      stdio: options.stdio || 'inherit',
      verifySnapshot: !bundled,
    });
    status = packageRuntimeStatus({ env, projectDir, nodeVersion: options.nodeVersion });
  }

  if (!status.buildPresent || !status.buildCurrent) {
    console.log(`[proxy-max] Building Proxy Max ${pkg.version} for this machine`);
    buildStandalone({
      projectDir,
      env,
      stdio: options.stdio || 'inherit',
      verifySnapshot: !bundled,
    });
    status = packageRuntimeStatus({ env, projectDir, nodeVersion: options.nodeVersion });
  }

  if (!status.ready) {
    throw new Error('Proxy Max runtime preparation did not produce a launchable build');
  }
  return { ...status, projectDir, materialized };
}

function runtimeEnvironment(env = process.env) {
  return {
    ...env,
    PROXY_MAX_DISTRIBUTION: 'npm',
    PROXY_MAX_NPM_CLI_PATH: __filename,
  };
}

function forwardSignals(child) {
  let stopping = false;
  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    if (child.exitCode === null && !child.signalCode) child.kill(signal);
    const timer = setTimeout(() => {
      if (child.exitCode === null && !child.signalCode) child.kill('SIGKILL');
    }, 5000);
    timer.unref();
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.once(signal, () => stop(signal));
  }
}

function startPackageRuntime(options = {}) {
  const inherited = options.env || process.env;
  const env = runtimeEnvironment(inherited);
  const prepared = preparePackageRuntime({ ...options, env });
  const host = String(options.host || env.PROXY_MAX_UNIFIED_HOST || DEFAULT_HOST).trim() || DEFAULT_HOST;
  const port = parsePort(options.port ?? env.PROXY_MAX_UNIFIED_PORT ?? env.PORT, DEFAULT_PORT);
  const child = spawnUnified({
    projectDir: prepared.projectDir,
    dataDir: resolveDataDir(env),
    env,
    host,
    port,
    prepare: true,
    stdio: options.stdio || 'inherit',
  });
  console.log(`[proxy-max] Proxy Max ${pkg.version} is running at http://${host}:${port}`);
  console.log(`[proxy-max] Dashboard: http://${host}:${port}/dashboard`);
  forwardSignals(child);
  child.once('error', (error) => {
    console.error(`[proxy-max] Failed to start: ${error.message}`);
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    if (code !== null) process.exitCode = code;
    else if (signal && !['SIGINT', 'SIGTERM', 'SIGHUP'].includes(signal)) process.exitCode = 1;
  });
  return child;
}

function printHelp() {
  console.log(`Proxy Max ${pkg.version}

Usage:
  proxy-max [start]          Prepare and run the dashboard on 127.0.0.1:8787
  proxy-max prepare          Install and build the versioned local runtime
  proxy-max doctor           Show runtime readiness without changing it
  proxy-max smoke            Prepare, then run an isolated health check
  proxy-max reset-password   Reset the running dashboard password
  proxy-max cache-dir        Print the versioned runtime directory
  proxy-max --version        Print the installed package version
  proxy-max --help           Show this help

Environment:
  PROXY_MAX_UNIFIED_HOST        Dashboard host (default: 127.0.0.1)
  PROXY_MAX_UNIFIED_PORT        Dashboard port (default: 8787)
  PROXY_MAX_UNIFIED_DATA_DIR    Persistent application data directory
  PROXY_MAX_RUNTIME_CACHE_DIR   Parent directory for versioned npm runtimes
`);
}

async function main(argv = process.argv.slice(2), options = {}) {
  const command = argv[0] || 'start';
  const env = options.env || process.env;
  if (command === '--version' || command === '-v' || command === 'version') {
    console.log(pkg.version);
    return;
  }
  if (command === '--help' || command === '-h' || command === 'help') {
    printHelp();
    return;
  }
  if (command === 'cache-dir') {
    console.log(packageRuntimeDir(env));
    return;
  }
  if (command === 'doctor') {
    const status = packageRuntimeStatus({ env, nodeVersion: options.nodeVersion });
    console.log(JSON.stringify({ packageVersion: pkg.version, projectDir: packageRuntimeDir(env), ...status }, null, 2));
    if (!status.ready) process.exitCode = 1;
    return;
  }
  if (command === 'prepare') {
    const status = preparePackageRuntime({ env, nodeVersion: options.nodeVersion });
    console.log(JSON.stringify({
      ok: true,
      packageVersion: pkg.version,
      projectDir: status.projectDir,
      buildId: status.buildId,
    }, null, 2));
    return;
  }
  if (command === 'smoke') {
    const prepared = preparePackageRuntime({ env, nodeVersion: options.nodeVersion });
    const result = await smokeStandalone({
      projectDir: prepared.projectDir,
      env: runtimeEnvironment(env),
      timeoutMs: 30000,
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (command === 'reset-password') {
    const { main: resetPassword } = require('../scripts/reset-unified-password');
    await resetPassword({ env });
    return;
  }
  if (command === 'start') {
    startPackageRuntime({ env, nodeVersion: options.nodeVersion });
    return;
  }
  throw new Error(`Unknown command '${command}'. Run proxy-max --help.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[proxy-max] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_HOST,
  DEFAULT_PORT,
  BUNDLED_RUNTIME_DIR,
  forwardSignals,
  installBundledRuntimeSource,
  main,
  packageRuntimeDir,
  packageRuntimeStatus,
  preparePackageRuntime,
  runtimeEnvironment,
  startPackageRuntime,
};
