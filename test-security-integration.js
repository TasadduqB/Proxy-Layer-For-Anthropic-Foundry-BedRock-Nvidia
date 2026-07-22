#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PROJECT_ROOT = __dirname;
const SERVER_PATH = path.join(PROJECT_ROOT, 'src', 'server.js');
const STARTUP_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 8_000;
const SHUTDOWN_TIMEOUT_MS = 4_000;
const JSON_BODY_LIMIT_BYTES = 1024 * 1024;
const ADMIN_TOKEN = 'integration-admin-token';
const INFERENCE_API_KEY = 'integration-inference-key';
const TRUSTED_CORS_ORIGIN = 'https://trusted.console.example';
const PROMPT_LOG_MARKER = 'PROMPT_CONTENT_MUST_NOT_REACH_REQUEST_LOGS_7d31';
const SYSTEM_LOG_MARKER = 'SYSTEM_CONTENT_MUST_NOT_REACH_REQUEST_LOGS_8a42';
const RESPONSE_LOG_MARKER = 'RESPONSE_CONTENT_MUST_NOT_REACH_REQUEST_LOGS_9b53';
const SUPPLIED_LOG_SECRET = 'sk-proj-proxymaxintegrationsecret0123456789';
const SUPPLIED_LOG_PASSWORD = 'prompt-password-secret-6c64';
const SUPPLIED_LOG_AWS_KEY = 'AKIAZYXWVUTSRQPONMLK';

const tempRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), 'proxy-max-security-integration-'),
);
const activeChildren = new Set();
const results = [];

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function appendLimited(current, chunk, limit = 128 * 1024) {
  const combined = current + chunk.toString('utf8');
  return combined.length <= limit ? combined : combined.slice(-limit);
}

function scenarioEnvironment(directory, overrides = {}) {
  const homeDirectory = path.join(directory, 'home');
  const logDirectory = path.join(directory, 'logs');
  fs.mkdirSync(homeDirectory, { recursive: true });
  fs.mkdirSync(logDirectory, { recursive: true });

  const environment = {
    ...process.env,
    HOME: homeDirectory,
    USERPROFILE: homeDirectory,
    APPDATA: path.join(homeDirectory, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(homeDirectory, 'AppData', 'Local'),
    HOST: '127.0.0.1',
    PORT: '0',
    PROXY_MAX_CONFIG: path.join(directory, 'config.json'),
    PROXY_MAX_LOG_DIR: logDirectory,
    PROXY_MAX_LOG_WRITE_MODE: 'sync',
    PROXY_MAX_MAX_BODY_BYTES: String(JSON_BODY_LIMIT_BYTES),
    PROXY_MAX_OPT_STATS_FLUSH_MS: '60000',
    NODE_NO_WARNINGS: '1',
  };

  // A caller's shell must not accidentally change the scenario under test.
  for (const name of [
    'PROXY_MAX_ADMIN_TOKEN',
    'PROXY_MAX_API_KEY',
    'PROXY_MAX_ALLOWED_ORIGINS',
    'PROXY_MAX_CORS_ORIGINS',
    'PROXY_MAX_CONFIG_JSON',
  ]) {
    delete environment[name];
  }

  return Object.assign(environment, overrides);
}

function writeScenarioConfig(directory, config) {
  const configPath = path.join(directory, 'config.json');
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

function childDiagnostics(instance) {
  const output = [
    instance.stdout.trim() && `stdout:\n${instance.stdout.trim()}`,
    instance.stderr.trim() && `stderr:\n${instance.stderr.trim()}`,
  ].filter(Boolean).join('\n');
  return output || '(no child output)';
}

async function startProxy(name, options = {}) {
  const directory = fs.mkdtempSync(path.join(tempRoot, `${name}-`));
  writeScenarioConfig(directory, options.config || {
    provider: null,
    providers: {},
  });

  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: PROJECT_ROOT,
    env: scenarioEnvironment(directory, options.environment),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  activeChildren.add(child);

  const instance = {
    child,
    directory,
    port: null,
    stdout: '',
    stderr: '',
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) {
        if (child.exitCode === null && child.signalCode === null) {
          try { child.kill('SIGKILL'); } catch {}
        }
        reject(error);
      }
      else resolve(instance);
    };

    const inspectStartupOutput = () => {
      const match = instance.stdout.match(
        /API base:\s+http:\/\/127\.0\.0\.1:(\d+)/u,
      );
      if (!match) return;
      const port = Number(match[1]);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        finish(new Error(`Proxy reported an invalid port: ${match[1]}`));
        return;
      }
      instance.port = port;
      finish();
    };

    child.stdout.on('data', chunk => {
      instance.stdout = appendLimited(instance.stdout, chunk);
      inspectStartupOutput();
    });
    child.stderr.on('data', chunk => {
      instance.stderr = appendLimited(instance.stderr, chunk);
    });
    child.once('error', error => {
      finish(new Error(`Unable to start Proxy-Max child: ${error.message}`));
    });
    child.once('exit', (code, signal) => {
      activeChildren.delete(child);
      if (!settled) {
        finish(new Error(
          `Proxy-Max exited before readiness (code=${code}, signal=${signal}).\n${childDiagnostics(instance)}`,
        ));
      }
    });

    timeout = setTimeout(() => {
      finish(new Error(
        `Proxy-Max did not become ready within ${STARTUP_TIMEOUT_MS}ms.\n${childDiagnostics(instance)}`,
      ));
    }, STARTUP_TIMEOUT_MS);
    timeout.unref?.();
  });
}

async function stopProxy(instance) {
  if (!instance || !instance.child) return;
  const { child } = instance;
  if (child.exitCode !== null || child.signalCode !== null) {
    activeChildren.delete(child);
    return;
  }

  const exited = new Promise(resolve => child.once('exit', resolve));
  try { child.kill('SIGTERM'); } catch {}
  await Promise.race([exited, delay(SHUTDOWN_TIMEOUT_MS)]);
  if (child.exitCode === null && child.signalCode === null) {
    try { child.kill('SIGKILL'); } catch {}
    await Promise.race([exited, delay(SHUTDOWN_TIMEOUT_MS)]);
  }
  activeChildren.delete(child);
}

function request(port, options = {}) {
  const method = options.method || 'GET';
  const body = options.body === undefined || options.body === null
    ? null
    : (Buffer.isBuffer(options.body) ? options.body : Buffer.from(String(options.body)));
  const headers = { ...(options.headers || {}) };
  if (body && !Object.keys(headers).some(name => name.toLowerCase() === 'content-length')) {
    headers['Content-Length'] = String(body.length);
  }

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: options.path || '/',
      method,
      headers,
      agent: false,
    }, response => {
      let responseBody = Buffer.alloc(0);
      response.on('data', chunk => {
        if (responseBody.length < 2 * 1024 * 1024) {
          responseBody = Buffer.concat([responseBody, chunk]);
        }
      });
      response.once('error', reject);
      response.on('end', () => {
        resolve({
          status: response.statusCode,
          headers: response.headers,
          body: responseBody.toString('utf8'),
        });
      });
    });

    req.once('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`HTTP request timed out after ${REQUEST_TIMEOUT_MS}ms`));
    });
    req.end(body || undefined);
  });
}

function expectStatus(response, expected) {
  if (response.status !== expected) {
    throw new Error(`expected HTTP ${expected}, received HTTP ${response.status}`);
  }
}

function parseJsonResponse(response, label) {
  try {
    return JSON.parse(response.body);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${error.message}`);
  }
}

async function waitFor(predicate, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(20);
  }
  if (lastError) throw lastError;
  throw new Error(`condition was not met within ${timeoutMs}ms`);
}

function preflightHeaders(origin) {
  return {
    Origin: origin,
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'Content-Type, X-Proxy-Max-Admin-Token',
  };
}

async function check(name, callback) {
  try {
    await callback();
    results.push({ name, passed: true });
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    results.push({ name, passed: false, error });
    process.stderr.write(`FAIL ${name}: ${error.message}\n`);
  }
}

async function runBaselineContract() {
  let proxy;
  try {
    proxy = await startProxy('baseline');
  } catch (error) {
    results.push({ name: 'baseline proxy startup', passed: false, error });
    process.stderr.write(`FAIL baseline proxy startup: ${error.message}\n`);
    return;
  }

  try {
    await check('GET / serves the UI', async () => {
      expectStatus(await request(proxy.port, { path: '/' }), 200);
    });

    for (const sensitivePath of ['/config.json', '/.git/config', '/src/server.js']) {
      await check(`GET ${sensitivePath} is not exposed`, async () => {
        expectStatus(await request(proxy.port, { path: sensitivePath }), 404);
      });
    }

    await check('cross-origin management request is forbidden', async () => {
      const response = await request(proxy.port, {
        path: '/api/config',
        headers: { Origin: 'https://evil.example' },
      });
      expectStatus(response, 403);
    });

    await check('local management request without Origin is allowed', async () => {
      expectStatus(await request(proxy.port, { path: '/api/config' }), 200);
    });

    await check('oversized JSON management body is rejected', async () => {
      const padding = 'x'.repeat(JSON_BODY_LIMIT_BYTES + 1024);
      const body = JSON.stringify({
        provider: 'nvidia',
        config: { padding },
      });
      const response = await request(proxy.port, {
        method: 'POST',
        path: '/api/config',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      expectStatus(response, 413);
    });

    await check('malformed JSON management body is rejected deterministically', async () => {
      const response = await request(proxy.port, {
        method: 'POST',
        path: '/api/config',
        headers: { 'Content-Type': 'application/json' },
        body: '{"provider":"nvidia","config":',
      });
      expectStatus(response, 400);
      const payload = parseJsonResponse(response, 'malformed JSON response');
      assert.equal(payload.code, 'INVALID_JSON_BODY');
    });
  } finally {
    await stopProxy(proxy);
  }
}

async function runAdminTokenContract() {
  let proxy;
  try {
    proxy = await startProxy('admin-token', {
      environment: {
        PROXY_MAX_ADMIN_TOKEN: ADMIN_TOKEN,
        PROXY_MAX_CORS_ORIGINS: TRUSTED_CORS_ORIGIN,
      },
    });
  } catch (error) {
    results.push({ name: 'admin-token proxy startup', passed: false, error });
    process.stderr.write(`FAIL admin-token proxy startup: ${error.message}\n`);
    return;
  }

  try {
    await check('management API requires configured admin token', async () => {
      expectStatus(await request(proxy.port, { path: '/api/config' }), 401);
    });

    await check('management API accepts x-proxy-max-admin-token', async () => {
      const response = await request(proxy.port, {
        path: '/api/config',
        headers: { 'x-proxy-max-admin-token': ADMIN_TOKEN },
      });
      expectStatus(response, 200);
    });

    await check('exact same-origin CORS preflight succeeds', async () => {
      const origin = `http://127.0.0.1:${proxy.port}`;
      const response = await request(proxy.port, {
        method: 'OPTIONS',
        path: '/api/config',
        headers: preflightHeaders(origin),
      });
      expectStatus(response, 204);
      assert.equal(response.headers['access-control-allow-origin'], origin);
      assert.match(response.headers['access-control-allow-methods'] || '', /(?:^|, )POST(?:,|$)/);
      assert.match(response.headers['access-control-allow-headers'] || '', /x-proxy-max-admin-token/);
      assert.notEqual(response.headers['access-control-allow-origin'], '*');
    });

    await check('exact allowlisted CORS preflight succeeds', async () => {
      const response = await request(proxy.port, {
        method: 'OPTIONS',
        path: '/api/config',
        headers: preflightHeaders(TRUSTED_CORS_ORIGIN),
      });
      expectStatus(response, 204);
      assert.equal(response.headers['access-control-allow-origin'], TRUSTED_CORS_ORIGIN);
      assert.notEqual(response.headers['access-control-allow-origin'], '*');
    });

    await check('non-allowlisted CORS preflight is denied without allow-origin', async () => {
      const response = await request(proxy.port, {
        method: 'OPTIONS',
        path: '/api/config',
        headers: preflightHeaders(`${TRUSTED_CORS_ORIGIN}.evil.example`),
      });
      expectStatus(response, 403);
      assert.equal(response.headers['access-control-allow-origin'], undefined);
    });
  } finally {
    await stopProxy(proxy);
  }
}

async function runConfigRedactionContract() {
  const providerSecrets = {
    apiKey: 'provider-api-secret-11a1',
    password: 'provider-password-secret-22b2',
    clientSecret: 'provider-client-secret-33c3',
    accessToken: 'provider-access-token-44d4',
    authorization: 'Bearer provider-authorization-secret-55e5',
    credentialPassword: 'provider-credential-password-66f6',
  };
  const poolSecrets = {
    apiKey: 'pool-api-secret-77a7',
    accessKeyId: 'AKIAABCDEFGHIJKLMNOP',
    secretAccessKey: 'pool-aws-secret-access-key-88b8',
    sessionToken: 'pool-session-token-99c9',
    password: 'pool-nested-password-a0d0',
    urlUser: 'pool-url-user-b1e1',
    urlPassword: 'pool-url-password-c2f2',
    urlQuery: 'pool-url-query-secret-d3a3',
  };
  const originalConfig = {
    provider: 'nvidia',
    providers: {
      nvidia: {
        endpoint: 'http://127.0.0.1:9/v1',
        model: 'redaction-provider-model',
        apiKey: providerSecrets.apiKey,
        password: providerSecrets.password,
        auth: {
          clientSecret: providerSecrets.clientSecret,
          accessToken: providerSecrets.accessToken,
        },
        headers: { Authorization: providerSecrets.authorization },
        credentials: { password: providerSecrets.credentialPassword },
      },
    },
    pool: [{
      provider: 'nvidia',
      model: 'redaction-pool-model',
      endpoint: `https://${poolSecrets.urlUser}:${poolSecrets.urlPassword}@pool.example/v1?api_key=${poolSecrets.urlQuery}`,
      apiKey: poolSecrets.apiKey,
      accessKeyId: poolSecrets.accessKeyId,
      secretAccessKey: poolSecrets.secretAccessKey,
      sessionToken: poolSecrets.sessionToken,
      nested: { password: poolSecrets.password },
      priority: 7,
    }],
  };

  let proxy;
  try {
    proxy = await startProxy('config-redaction', { config: originalConfig });
  } catch (error) {
    results.push({ name: 'config-redaction proxy startup', passed: false, error });
    process.stderr.write(`FAIL config-redaction proxy startup: ${error.message}\n`);
    return;
  }

  try {
    let redactedConfig;
    await check('config GET deeply redacts provider and pool credentials', async () => {
      const response = await request(proxy.port, { path: '/api/config' });
      expectStatus(response, 200);
      redactedConfig = parseJsonResponse(response, 'config GET');

      const provider = redactedConfig.providers?.nvidia;
      const pool = redactedConfig.pool?.[0];
      assert.equal(provider?.model, originalConfig.providers.nvidia.model);
      assert.equal(provider?.apiKey, '[REDACTED]');
      assert.equal(provider?.password, '[REDACTED]');
      assert.equal(provider?.auth?.clientSecret, '[REDACTED]');
      assert.equal(provider?.auth?.accessToken, '[REDACTED]');
      assert.equal(provider?.headers?.Authorization, '[REDACTED]');
      assert.equal(provider?.credentials, '[REDACTED]');

      assert.equal(pool?.model, originalConfig.pool[0].model);
      assert.equal(pool?.priority, 7);
      assert.equal(pool?.apiKey, '[REDACTED]');
      assert.equal(pool?.accessKeyId, '[REDACTED]');
      assert.equal(pool?.secretAccessKey, '[REDACTED]');
      assert.equal(pool?.sessionToken, '[REDACTED]');
      assert.equal(pool?.nested?.password, '[REDACTED]');
      assert.match(pool?.endpoint || '', /\[REDACTED\]/);

      const serialized = JSON.stringify(redactedConfig);
      for (const secret of [...Object.values(providerSecrets), ...Object.values(poolSecrets)]) {
        assert.equal(serialized.includes(secret), false, `config GET leaked ${secret}`);
      }
    });

    await check('posting config redaction placeholders preserves secrets on disk', async () => {
      assert(redactedConfig, 'config GET must complete before round-trip test');
      const response = await request(proxy.port, {
        method: 'POST',
        path: '/api/config',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: redactedConfig.provider,
          config: redactedConfig.providers.nvidia,
        }),
      });
      expectStatus(response, 200);

      const stored = JSON.parse(fs.readFileSync(
        path.join(proxy.directory, 'config.json'),
        'utf8',
      ));
      assert.deepEqual(stored.providers.nvidia, originalConfig.providers.nvidia);
      assert.deepEqual(stored.pool, originalConfig.pool);
    });
  } finally {
    await stopProxy(proxy);
  }
}

function startUpstreamSentinel(options = {}) {
  let requests = 0;
  const paths = [];
  const responseContent = options.responseContent || 'upstream sentinel reached';
  const server = http.createServer((req, res) => {
    requests += 1;
    paths.push(req.url);
    req.resume();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'sentinel-response',
      object: 'chat.completion',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: responseContent },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address !== 'object') {
        reject(new Error('Upstream sentinel did not report a TCP address'));
        return;
      }
      resolve({
        server,
        port: address.port,
        requestCount: () => requests,
        requestPaths: () => [...paths],
      });
    });
  });
}

async function closeServer(server) {
  if (!server || !server.listening) return;
  await new Promise(resolve => {
    server.close(resolve);
    server.closeIdleConnections?.();
  });
}

async function runInferenceKeyContract() {
  let sentinel;
  let proxy;
  try {
    sentinel = await startUpstreamSentinel({ responseContent: RESPONSE_LOG_MARKER });
    proxy = await startProxy('inference-key', {
      environment: { PROXY_MAX_API_KEY: INFERENCE_API_KEY },
      config: {
        provider: 'nvidia',
        providers: {
          nvidia: {
            endpoint: `http://127.0.0.1:${sentinel.port}`,
            apiKey: 'sentinel-upstream-key',
            model: 'sentinel-model',
          },
        },
      },
    });
  } catch (error) {
    results.push({ name: 'inference-key proxy startup', passed: false, error });
    process.stderr.write(`FAIL inference-key proxy startup: ${error.message}\n`);
    await stopProxy(proxy);
    await closeServer(sentinel?.server);
    return;
  }

  const body = JSON.stringify({
    model: 'sentinel-model',
    max_tokens: 8,
    stream: false,
    system: `${SYSTEM_LOG_MARKER} credential=${SUPPLIED_LOG_SECRET}`,
    messages: [{
      role: 'user',
      content: `${PROMPT_LOG_MARKER} password=${SUPPLIED_LOG_PASSWORD} aws_key=${SUPPLIED_LOG_AWS_KEY}`,
    }],
  });
  const sendInference = apiKey => request(proxy.port, {
    method: 'POST',
    path: '/v1/messages',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...(apiKey === undefined ? {} : { 'x-api-key': apiKey }),
    },
    body,
  });

  try {
    await check('inference API rejects a missing key before upstream', async () => {
      const response = await sendInference(undefined);
      expectStatus(response, 401);
      assert.equal(sentinel.requestCount(), 0);
      assert.deepEqual(sentinel.requestPaths(), []);
    });

    await check('inference API rejects a wrong x-api-key before upstream', async () => {
      const response = await sendInference('wrong-inference-key');
      expectStatus(response, 401);
      assert.equal(sentinel.requestCount(), 0);
      assert.deepEqual(sentinel.requestPaths(), []);
    });

    await check('configured x-api-key reaches upstream sentinel exactly once', async () => {
      const response = await sendInference(INFERENCE_API_KEY);
      expectStatus(response, 200);
      assert.equal(sentinel.requestCount(), 1);
      assert.deepEqual(sentinel.requestPaths(), ['/chat/completions']);
      assert.match(response.body, new RegExp(RESPONSE_LOG_MARKER));
    });

    await check('default request logs omit content and recognizable secrets', async () => {
      const logPath = path.join(proxy.directory, 'logs', 'requests.log');
      const rawLog = await waitFor(() => {
        if (!fs.existsSync(logPath)) return null;
        const raw = fs.readFileSync(logPath, 'utf8');
        return raw.trim() ? raw : null;
      });
      const forbidden = [
        PROMPT_LOG_MARKER,
        SYSTEM_LOG_MARKER,
        RESPONSE_LOG_MARKER,
        SUPPLIED_LOG_SECRET,
        SUPPLIED_LOG_PASSWORD,
        SUPPLIED_LOG_AWS_KEY,
        INFERENCE_API_KEY,
        'sentinel-upstream-key',
      ];
      for (const value of forbidden) {
        assert.equal(rawLog.includes(value), false, `request log exposed forbidden value ${value}`);
      }

      const entries = rawLog.trim().split(/\r?\n/u).map(line => JSON.parse(line));
      const entry = entries.at(-1);
      assert.equal(entry.request?.lastMessagePreview, null);
      assert.equal(entry.request?.systemPreview, null);
      assert.deepEqual(entry.request?.inputCapture, []);
      assert.equal(entry.responseCapture, null);
      assert(entry.attempts?.every(attempt => attempt.responsePreview === null));

      const response = await request(proxy.port, { path: '/api/logs/file?lines=20' });
      expectStatus(response, 200);
      for (const value of forbidden) {
        assert.equal(response.body.includes(value), false, `logs API exposed forbidden value ${value}`);
      }
    });
  } finally {
    await stopProxy(proxy);
    await closeServer(sentinel?.server);
  }
}

async function cleanup() {
  await Promise.all([...activeChildren].map(child => stopProxy({ child })));
  try {
    fs.rmSync(tempRoot, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  } catch (error) {
    process.stderr.write(`WARN unable to remove temporary directory: ${error.message}\n`);
  }
}

async function main() {
  try {
    await runBaselineContract();
    await runAdminTokenContract();
    await runConfigRedactionContract();
    await runInferenceKeyContract();
  } finally {
    await cleanup();
  }

  const failed = results.filter(result => !result.passed);
  const passed = results.length - failed.length;
  process.stdout.write(`\nSecurity integration: ${passed} passed, ${failed.length} failed\n`);
  if (failed.length) {
    process.stderr.write('Unmet hardened contracts:\n');
    for (const result of failed) {
      process.stderr.write(`- ${result.name}: ${result.error.message}\n`);
    }
    process.exitCode = 1;
  }
}

process.once('exit', () => {
  for (const child of activeChildren) {
    try { child.kill('SIGKILL'); } catch {}
  }
});

main().catch(async error => {
  await cleanup();
  process.stderr.write(`Security integration harness failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
