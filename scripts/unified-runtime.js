#!/usr/bin/env node
'use strict';

const {
  buildStandalone,
  installDependencies,
  prepareStandalone,
  runtimeStatus,
  smokeStandalone,
  spawnUnified,
} = require('../src/runtime/unified-runtime');
const { materializeRuntimeSource } = require('../src/runtime/unified-source');

function printHelp() {
  console.log(`Proxy-Max unified runtime

Usage: node scripts/unified-runtime.js <command>

Commands:
  doctor   Check source, dependencies, build, runtime, and isolated data path
  materialize  Compose pinned source + reviewed overlays into the runtime tree
  install  Verify the pinned source and install its locked dependencies
  build    Verify and build the pinned standalone Next.js application
  prepare  Copy static/public assets and the hardened custom server into the build
  smoke    Boot an isolated instance and verify health, models, and dashboard routing
  start    Start unified in the foreground (safe default: 127.0.0.1:20128)

Environment:
  PROXY_MAX_UNIFIED_HOST       Bind host (default: 127.0.0.1)
  PROXY_MAX_UNIFIED_PORT       Bind port (default: 20128)
  PROXY_MAX_UNIFIED_DATA_DIR   Isolated data directory
`);
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

async function main() {
  const command = process.argv[2] || 'help';
  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }
  if (command === 'doctor') {
    const status = runtimeStatus();
    console.log(JSON.stringify(status, null, 2));
    if (!status.ready) process.exitCode = 1;
    return;
  }
  if (command === 'materialize') {
    const result = materializeRuntimeSource({ force: process.argv.includes('--force') });
    console.log(JSON.stringify({ ok: true, runtimeDir: result.runtimeDir, digest: result.digest, overlayFiles: result.overlayFiles.length, unchanged: result.unchanged }, null, 2));
    return;
  }
  if (command === 'install') {
    installDependencies();
    return;
  }
  if (command === 'build') {
    const built = buildStandalone();
    console.log(JSON.stringify({ ok: true, buildId: built.buildId, standaloneDir: built.standaloneDir }, null, 2));
    return;
  }
  if (command === 'prepare') {
    const prepared = prepareStandalone();
    console.log(JSON.stringify({ ok: true, buildId: prepared.buildId, standaloneDir: prepared.standaloneDir }, null, 2));
    return;
  }
  if (command === 'smoke') {
    const result = await smokeStandalone();
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (command === 'start') {
    const child = spawnUnified();
    const info = child.proxyMaxRuntime;
    console.log(`[proxy-max] unified ${info.buildId || 'build'} on http://${info.host}:${info.port}`);
    console.log(`[proxy-max] isolated unified data: ${info.dataDir}`);
    forwardSignals(child);
    child.once('error', (error) => {
      console.error(`[proxy-max] unified failed to start: ${error.message}`);
      process.exitCode = 1;
    });
    child.once('exit', (code, signal) => {
      if (code !== null) process.exitCode = code;
      else if (signal && !['SIGINT', 'SIGTERM', 'SIGHUP'].includes(signal)) process.exitCode = 1;
    });
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(`[proxy-max] ${error.message}`);
  process.exitCode = 1;
});
