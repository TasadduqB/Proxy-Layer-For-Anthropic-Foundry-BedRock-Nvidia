'use strict';

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const {
  PINNED_SOURCE_DIR,
  RUNTIME_PROJECT_DIR,
  materializeRuntimeSource,
} = require('./unified-source');

const ROOT = path.resolve(__dirname, '../..');
const DEFAULT_UPSTREAM_DIR = PINNED_SOURCE_DIR;
const DEFAULT_PROJECT_DIR = RUNTIME_PROJECT_DIR;
const DEFAULT_PORT = 20128;
const DEFAULT_HOST = '127.0.0.1';
// Next.js 16 accepts Node 20.9, while the locked Undici and Vite toolchain
// require newer Node 20 patch levels. Enforce the stricter end-to-end floor.
const MIN_NODE_VERSION = Object.freeze([20, 19, 0]);

function parseVersion(value) {
  const match = String(value || '').replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    const delta = Number(left[index] || 0) - Number(right[index] || 0);
    if (delta !== 0) return delta > 0 ? 1 : -1;
  }
  return 0;
}

function assertSupportedNode(version = process.versions.node) {
  const parsed = parseVersion(version);
  if (!parsed || compareVersions(parsed, MIN_NODE_VERSION) < 0) {
    throw new Error(`unified requires Node >= ${MIN_NODE_VERSION.join('.')} (current: ${version || 'unknown'}). Proxy-Max legacy mode still supports Node >= 18.`);
  }
  return parsed;
}

function parsePort(value, fallback = DEFAULT_PORT) {
  const candidate = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(candidate) || candidate < 1 || candidate > 65535) {
    throw new TypeError(`Invalid unified port: ${value}`);
  }
  return candidate;
}

function resolveDataDir(env = process.env) {
  const explicit = env.PROXY_MAX_UNIFIED_DATA_DIR || env.PROXY_MAX_NEXT_DATA_DIR;
  if (explicit) return path.resolve(explicit);
  if (env.PROXY_MAX_DATA_DIR) return path.join(path.resolve(env.PROXY_MAX_DATA_DIR), 'unified');
  return path.join(os.homedir(), '.proxy-max', 'unified');
}

function ensurePrivateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(directory, 0o700); } catch { /* Windows/filesystem may not support POSIX modes. */ }
  return directory;
}

function runtimePaths(upstreamDir = DEFAULT_PROJECT_DIR) {
  const projectDir = path.resolve(upstreamDir);
  const nextDir = path.join(projectDir, '.next');
  const standaloneDir = path.join(nextDir, 'standalone');
  return {
    projectDir,
    nextDir,
    standaloneDir,
    serverPath: path.join(standaloneDir, 'server.js'),
    customServerSource: path.join(projectDir, 'custom-server.js'),
    customServerPath: path.join(standaloneDir, 'custom-server.js'),
    staticSource: path.join(nextDir, 'static'),
    staticDestination: path.join(standaloneDir, '.next', 'static'),
    publicSource: path.join(projectDir, 'public'),
    publicDestination: path.join(standaloneDir, 'public'),
    packageLock: path.join(projectDir, 'package-lock.json'),
    nodeModules: path.join(projectDir, 'node_modules'),
    buildIdPath: path.join(nextDir, 'BUILD_ID'),
    sourceStamp: path.join(projectDir, '.proxy-max-source.json'),
    buildSourceStamp: path.join(nextDir, '.proxy-max-build-source.json'),
  };
}

function readJsonFile(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function copyTree(source, destination) {
  if (!fs.existsSync(source)) return false;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true, force: true, preserveTimestamps: true });
  return true;
}

function prepareStandalone(options = {}) {
  const paths = runtimePaths(options.upstreamDir || options.projectDir);
  if (!fs.existsSync(paths.serverPath) || !fs.existsSync(paths.buildIdPath)) {
    throw new Error('unified standalone build is missing. Run `npm run unified:build` first.');
  }
  if (!fs.existsSync(paths.customServerSource)) {
    throw new Error(`Pinned unified custom server is missing: ${paths.customServerSource}`);
  }
  const sourceStamp = readJsonFile(paths.sourceStamp);
  const buildSourceStamp = readJsonFile(paths.buildSourceStamp);
  if (sourceStamp?.digest && buildSourceStamp?.sourceDigest !== sourceStamp.digest) {
    throw new Error('unified standalone build is stale for the current Proxy-Max overlays. Run `npm run unified:build`.');
  }

  fs.copyFileSync(paths.customServerSource, paths.customServerPath);
  const copiedStatic = copyTree(paths.staticSource, paths.staticDestination);
  const copiedPublic = copyTree(paths.publicSource, paths.publicDestination);
  const buildId = fs.readFileSync(paths.buildIdPath, 'utf8').trim();
  const stamp = {
    schemaVersion: 1,
    buildId,
    launcher: 'custom-server.js',
    copiedStatic,
    copiedPublic,
    sourceDigest: buildSourceStamp?.sourceDigest || sourceStamp?.digest || null,
  };
  fs.writeFileSync(
    path.join(paths.standaloneDir, '.proxy-max-runtime.json'),
    `${JSON.stringify(stamp, null, 2)}\n`,
    { mode: 0o600 },
  );
  return { ...paths, ...stamp };
}

function buildRuntimeEnv(options = {}) {
  const inherited = options.env || process.env;
  const dataDir = ensurePrivateDirectory(options.dataDir || resolveDataDir(inherited));
  const port = parsePort(options.port ?? inherited.PROXY_MAX_UNIFIED_PORT ?? inherited.PORT, DEFAULT_PORT);
  const host = String(options.host || inherited.PROXY_MAX_UNIFIED_HOST || DEFAULT_HOST).trim() || DEFAULT_HOST;
  const runtimeEnv = {
    ...inherited,
    DATA_DIR: dataDir,
    HOSTNAME: host,
    PORT: String(port),
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    PROXY_MAX_SOURCE_ROOT: path.resolve(inherited.PROXY_MAX_SOURCE_ROOT || ROOT),
  };
  // This marker is owned by buildStandalone. Never let a stale inherited
  // value shard the persistent runtime database by process.
  delete runtimeEnv.PROXY_MAX_UNIFIED_BUILD_DATA_ROOT;
  return runtimeEnv;
}

function buildStandaloneEnv(inherited, buildDataDir) {
  return {
    ...inherited,
    DATA_DIR: buildDataDir,
    // Next renders static routes in parallel processes (and may use worker
    // threads in future configurations). The app derives a worker-scoped data
    // directory from this build-only root, preventing SQLite schema races.
    PROXY_MAX_UNIFIED_BUILD_DATA_ROOT: buildDataDir,
    NEXT_TELEMETRY_DISABLED: '1',
  };
}

function spawnUnified(options = {}) {
  assertSupportedNode(options.nodeVersion);
  const prepared = options.prepare === false
    ? runtimePaths(options.upstreamDir || options.projectDir)
    : prepareStandalone(options);
  const env = buildRuntimeEnv(options);
  const nodeArgs = [
    '--dns-result-order=ipv4first',
    `--max-old-space-size=${Number(options.maxOldSpaceMb) > 0 ? Math.trunc(Number(options.maxOldSpaceMb)) : 6144}`,
    prepared.customServerPath,
  ];
  const child = spawn(options.nodePath || process.execPath, nodeArgs, {
    cwd: prepared.standaloneDir,
    env,
    stdio: options.stdio || 'inherit',
    shell: false,
    windowsHide: true,
  });
  child.proxyMaxRuntime = {
    mode: 'unified',
    host: env.HOSTNAME,
    port: Number(env.PORT),
    dataDir: env.DATA_DIR,
    buildId: prepared.buildId || (fs.existsSync(prepared.buildIdPath)
      ? fs.readFileSync(prepared.buildIdPath, 'utf8').trim()
      : null),
  };
  return child;
}

function npmInvocation(args, options = {}) {
  const env = options.env || process.env;
  const npmExecPath = env.npm_execpath && fs.existsSync(env.npm_execpath)
    ? env.npm_execpath
    : null;
  return npmExecPath
    ? { command: process.execPath, args: [npmExecPath, ...args] }
    : { command: process.platform === 'win32' ? 'npm.cmd' : 'npm', args };
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    env: options.env || process.env,
    stdio: options.stdio || 'inherit',
    shell: false,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const printable = [command, ...args].join(' ');
    throw new Error(`Command failed (${result.status}): ${printable}`);
  }
  return result;
}

function verifySnapshot(options = {}) {
  return runChecked(process.execPath, [path.join(ROOT, 'scripts', 'verify-upstream-snapshot.js')], {
    cwd: ROOT,
    env: options.env,
    stdio: options.stdio,
  });
}

function installDependencies(options = {}) {
  assertSupportedNode(options.nodeVersion);
  if (options.verifySnapshot !== false) verifySnapshot(options);
  const projectDir = options.upstreamDir || options.projectDir
    ? path.resolve(options.upstreamDir || options.projectDir)
    : materializeRuntimeSource().runtimeDir;
  const paths = runtimePaths(projectDir);
  if (!fs.existsSync(paths.packageLock)) {
    throw new Error(`unified dependency lock is missing: ${paths.packageLock}`);
  }
  const invocation = npmInvocation(['ci', '--ignore-scripts', '--no-audit', '--no-fund'], options);
  return runChecked(invocation.command, invocation.args, {
    cwd: paths.projectDir,
    env: options.env,
    stdio: options.stdio,
  });
}

function buildStandalone(options = {}) {
  assertSupportedNode(options.nodeVersion);
  if (options.verifySnapshot !== false) verifySnapshot(options);
  const projectDir = options.upstreamDir || options.projectDir
    ? path.resolve(options.upstreamDir || options.projectDir)
    : materializeRuntimeSource().runtimeDir;
  const paths = runtimePaths(projectDir);
  if (!fs.existsSync(paths.nodeModules)) {
    throw new Error('unified dependencies are missing. Run `npm run unified:install` first.');
  }
  const inherited = options.env || process.env;
  const explicitBuildDataDir = options.buildDataDir || inherited.PROXY_MAX_UNIFIED_BUILD_DATA_DIR;
  const buildDataDir = explicitBuildDataDir
    ? ensurePrivateDirectory(path.resolve(explicitBuildDataDir))
    : fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-max-unified-build-'));
  const env = buildStandaloneEnv(inherited, buildDataDir);
  try {
    const invocation = npmInvocation(['run', 'build'], { ...options, env });
    runChecked(invocation.command, invocation.args, {
      cwd: paths.projectDir,
      env,
      stdio: options.stdio,
    });
    const sourceStamp = readJsonFile(paths.sourceStamp);
    const builtId = fs.readFileSync(paths.buildIdPath, 'utf8').trim();
    fs.writeFileSync(paths.buildSourceStamp, `${JSON.stringify({
      schemaVersion: 1,
      sourceDigest: sourceStamp?.digest || null,
      buildId: builtId,
    }, null, 2)}\n`, { mode: 0o600 });
    return prepareStandalone({ ...options, projectDir: paths.projectDir });
  } finally {
    if (!explicitBuildDataDir) {
      try { fs.rmSync(buildDataDir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }
}

function runtimeStatus(options = {}) {
  const paths = runtimePaths(options.upstreamDir || options.projectDir);
  let nodeSupported = true;
  let nodeError = null;
  try { assertSupportedNode(options.nodeVersion); } catch (error) { nodeSupported = false; nodeError = error.message; }
  const status = {
    node: process.version,
    nodeSupported,
    nodeError,
    sourcePresent: fs.existsSync(path.join(paths.projectDir, 'package.json')),
    lockPresent: fs.existsSync(paths.packageLock),
    dependenciesPresent: fs.existsSync(paths.nodeModules),
    buildPresent: fs.existsSync(paths.serverPath) && fs.existsSync(paths.buildIdPath),
    customServerPresent: fs.existsSync(paths.customServerSource),
    dataDir: resolveDataDir(options.env || process.env),
    port: parsePort(options.port ?? (options.env || process.env).PROXY_MAX_UNIFIED_PORT, DEFAULT_PORT),
    host: String(options.host || (options.env || process.env).PROXY_MAX_UNIFIED_HOST || DEFAULT_HOST),
  };
  const sourceStamp = readJsonFile(paths.sourceStamp);
  const buildSourceStamp = readJsonFile(paths.buildSourceStamp);
  status.sourceDigest = sourceStamp?.digest || null;
  status.buildSourceDigest = buildSourceStamp?.sourceDigest || null;
  status.buildCurrent = !status.sourceDigest || status.sourceDigest === status.buildSourceDigest;
  status.ready = status.nodeSupported && status.sourcePresent && status.lockPresent &&
    status.dependenciesPresent && status.buildPresent && status.customServerPresent && status.buildCurrent;
  if (status.buildPresent) status.buildId = fs.readFileSync(paths.buildIdPath, 'utf8').trim();
  return status;
}

function reservePort(host = DEFAULT_HOST) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function waitForHealth(url, child, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      if (child.exitCode !== null || child.signalCode) {
        reject(new Error(`unified exited before becoming healthy (${child.exitCode ?? child.signalCode})`));
        return;
      }
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
        if (response.ok) {
          resolve(response);
          return;
        }
      } catch { /* Retry until the bounded deadline. */ }
      if (Date.now() >= deadline) {
        reject(new Error(`Timed out waiting for ${url}`));
        return;
      }
      setTimeout(attempt, 150);
    };
    attempt();
  });
}

async function smokeStandalone(options = {}) {
  assertSupportedNode(options.nodeVersion);
  const host = DEFAULT_HOST;
  const port = options.port || await reservePort(host);
  const temporaryDataDir = options.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-max-unified-smoke-'));
  let stderr = '';
  const child = spawnUnified({
    ...options,
    host,
    port,
    dataDir: temporaryDataDir,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-12000);
  });
  try {
    const baseUrl = `http://${host}:${port}`;
    await waitForHealth(`${baseUrl}/api/health`, child, options.timeoutMs || 30000);
    const [healthResponse, modelsResponse, dashboardResponse] = await Promise.all([
      fetch(`${baseUrl}/api/health`),
      fetch(`${baseUrl}/v1/models`),
      fetch(`${baseUrl}/dashboard`, { redirect: 'manual' }),
    ]);
    const health = await healthResponse.json();
    const models = await modelsResponse.json();
    return {
      ok: healthResponse.ok && modelsResponse.ok && health?.ok === true && Array.isArray(models?.data),
      healthStatus: healthResponse.status,
      modelsStatus: modelsResponse.status,
      modelCount: Array.isArray(models?.data) ? models.data.length : 0,
      dashboardStatus: dashboardResponse.status,
      dashboardLocation: dashboardResponse.headers.get('location'),
      buildId: child.proxyMaxRuntime.buildId,
    };
  } catch (error) {
    error.message = `${error.message}${stderr ? `\nunified stderr:\n${stderr}` : ''}`;
    throw error;
  } finally {
    if (child.exitCode === null && !child.signalCode) child.kill('SIGTERM');
    await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode) return resolve();
      const timer = setTimeout(() => {
        if (child.exitCode === null && !child.signalCode) child.kill('SIGKILL');
        resolve();
      }, 3000);
      timer.unref();
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    if (!options.dataDir) {
      try { fs.rmSync(temporaryDataDir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }
}

module.exports = {
  ROOT,
  DEFAULT_UPSTREAM_DIR,
  DEFAULT_PROJECT_DIR,
  DEFAULT_PORT,
  DEFAULT_HOST,
  MIN_NODE_VERSION,
  parseVersion,
  compareVersions,
  assertSupportedNode,
  parsePort,
  resolveDataDir,
  runtimePaths,
  prepareStandalone,
  buildRuntimeEnv,
  buildStandaloneEnv,
  spawnUnified,
  verifySnapshot,
  installDependencies,
  buildStandalone,
  runtimeStatus,
  reservePort,
  waitForHealth,
  smokeStandalone,
};
