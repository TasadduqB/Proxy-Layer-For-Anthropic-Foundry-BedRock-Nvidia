#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawn } = require('child_process');
const { parsePort, spawnUnified } = require('./unified-runtime');

const ROOT = path.resolve(__dirname, '../..');
const LEGACY_SERVER = path.join(ROOT, 'src', 'server.js');
const VALID_MODES = new Set(['legacy', 'unified', 'parallel']);

function normalizeMode(value) {
  const mode = String(value || 'unified').trim().toLowerCase();
  const normalized = mode === 'next' || mode === 'full' ? 'unified' : mode;
  if (!VALID_MODES.has(normalized)) {
    throw new Error(`Invalid PROXY_MAX_RUNTIME '${value}'. Expected legacy, unified, or parallel.`);
  }
  return normalized;
}

function spawnLegacy(env, options = {}) {
  return spawn(process.execPath, [LEGACY_SERVER], {
    cwd: ROOT,
    env,
    stdio: options.stdio || 'inherit',
    shell: false,
    windowsHide: true,
  });
}

function describeChild(name, child) {
  child.once('error', (error) => {
    console.error(`[proxy-max] ${name} failed to start: ${error.message}`);
  });
  return { name, child };
}

function startRuntime(options = {}) {
  const inherited = options.env || process.env;
  const mode = normalizeMode(options.mode || inherited.PROXY_MAX_RUNTIME);
  const children = [];

  if (mode === 'legacy' || mode === 'parallel') {
    const legacyPort = parsePort(
      mode === 'parallel' ? (inherited.PROXY_MAX_LEGACY_PORT || inherited.PORT) : inherited.PORT,
      8787,
    );
    const legacyHost = inherited.PROXY_MAX_LEGACY_HOST || inherited.HOST || '127.0.0.1';
    const legacyEnv = { ...inherited, PORT: String(legacyPort), HOST: legacyHost };
    children.push(describeChild('legacy runtime', spawnLegacy(legacyEnv, options)));
    console.log(`[proxy-max] legacy runtime: http://${legacyHost}:${legacyPort}`);
  }

  if (mode === 'unified' || mode === 'parallel') {
    const unifiedPort = parsePort(
      inherited.PROXY_MAX_UNIFIED_PORT || (mode === 'unified' ? inherited.PORT : undefined),
      mode === 'unified' ? 8787 : 20128,
    );
    if (mode === 'parallel') {
      const legacyPort = parsePort(inherited.PROXY_MAX_LEGACY_PORT || inherited.PORT, 8787);
      if (legacyPort === unifiedPort) throw new Error(`Parallel runtime port collision on ${unifiedPort}. Set PROXY_MAX_UNIFIED_PORT or PROXY_MAX_LEGACY_PORT.`);
    }
    const unifiedHost = inherited.PROXY_MAX_UNIFIED_HOST || '127.0.0.1';
    const child = spawnUnified({ ...options, env: inherited, port: unifiedPort, host: unifiedHost });
    children.push(describeChild('unified runtime', child));
    console.log(`[proxy-max] unified runtime: http://${unifiedHost}:${unifiedPort}`);
    console.log(`[proxy-max] unified data: ${child.proxyMaxRuntime.dataDir}`);
  }

  return { mode, children };
}

function supervise(runtime) {
  let stopping = false;
  const stopAll = (signal = 'SIGTERM') => {
    if (stopping) return;
    stopping = true;
    for (const { child } of runtime.children) {
      if (child.exitCode === null && !child.signalCode) child.kill(signal);
    }
    const timer = setTimeout(() => {
      for (const { child } of runtime.children) {
        if (child.exitCode === null && !child.signalCode) child.kill('SIGKILL');
      }
    }, 5000);
    timer.unref();
  };

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.once(signal, () => stopAll(signal));
  }

  for (const { name, child } of runtime.children) {
    child.once('exit', (code, signal) => {
      if (!stopping) {
        console.error(`[proxy-max] ${name} exited (${code ?? signal}); stopping sibling runtimes.`);
        process.exitCode = code === 0 ? 1 : (code || 1);
        stopAll('SIGTERM');
      }
    });
  }
}

if (require.main === module) {
  try {
    const runtime = startRuntime({ mode: process.argv[2] });
    supervise(runtime);
  } catch (error) {
    console.error(`[proxy-max] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { normalizeMode, startRuntime, supervise };
