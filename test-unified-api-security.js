'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildMigrationPlan, applyMigrationPlan, ensureCliAuthFiles } = require('./src/migration/unified-migration');
const {
  DEFAULT_HOST, reservePort, runtimeStatus, spawnUnified, waitForHealth,
} = require('./src/runtime/unified-runtime');

async function stopChild(child) {
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
}

(async () => {
  if (!runtimeStatus().ready) {
    console.log('unified API security integration skipped (standalone build not installed)');
    return;
  }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-max-api-security-'));
  let child;
  try {
    const plan = buildMigrationPlan({
      provider: 'nvidia',
      providers: { nvidia: {
        model: 'nvidia/nemotron-3-ultra-550b-a55b',
        endpoint: 'https://integrate.api.nvidia.com/v1',
        apiKey: 'integration-only-secret',
      } },
    }, { source: 'api-security-fixture' });
    await applyMigrationPlan(plan, { dataDir, stdio: ['ignore', 'ignore', 'pipe'] });

    const cliToken = ensureCliAuthFiles(dataDir);
    const port = await reservePort(DEFAULT_HOST);
    child = spawnUnified({ dataDir, host: DEFAULT_HOST, port, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-12000); });
    const baseUrl = `http://${DEFAULT_HOST}:${port}`;
    await waitForHealth(`${baseUrl}/api/health`, child, 30000);

    const request = async (pathname, options = {}) => {
      const response = await fetch(`${baseUrl}${pathname}`, {
        ...options,
        headers: {
          'x-9r-cli-token': cliToken,
          ...(options.body ? { 'content-type': 'application/json' } : {}),
          ...(options.headers || {}),
        },
      });
      const body = await response.json();
      assert(response.ok, `${options.method || 'GET'} ${pathname} failed (${response.status}): ${JSON.stringify(body)}${stderr ? `\n${stderr}` : ''}`);
      return body;
    };

    await request('/api/settings', { method: 'PATCH', body: JSON.stringify({
      oidcIssuerUrl: 'https://identity.example/.well-known/openid-configuration',
      oidcClientId: 'proxy-max-client',
      oidcClientSecret: 'oidc-integration-secret',
      outboundProxyEnabled: true,
      outboundProxyUrl: 'http://proxy-user:proxy-secret@proxy.example:8080',
    }) });
    const createdPool = await request('/api/proxy-pools', { method: 'POST', body: JSON.stringify({
      name: 'integration proxy',
      proxyUrl: 'http://pool-user:pool-secret@proxy.example:8181',
      type: 'http',
    }) });

    const providers = await request('/api/providers');
    const settings = await request('/api/settings');
    const pools = await request('/api/proxy-pools');
    const publicPayload = JSON.stringify({ providers, settings, pools });
    for (const secret of ['integration-only-secret', 'oidc-integration-secret', 'proxy-secret', 'pool-secret']) {
      assert(!publicPayload.includes(secret), `protected API response leaked ${secret}`);
    }
    assert.strictEqual(settings.oidcConfigured, true);
    assert(!Object.prototype.hasOwnProperty.call(settings, 'oidcClientSecret'));
    assert(decodeURIComponent(settings.outboundProxyUrl).includes('••••••••'));
    assert(decodeURIComponent(pools.proxyPools[0].proxyUrl).includes('••••••••'));
    assert(!Object.prototype.hasOwnProperty.call(providers.connections[0], 'apiKey'));

    // Redacted dashboard objects must preserve stored credentials on round-trip.
    await request('/api/settings', { method: 'PATCH', body: JSON.stringify({ ...settings, stickyRoundRobinLimit: 7 }) });
    await request(`/api/proxy-pools/${createdPool.proxyPool.id}`, { method: 'PUT', body: JSON.stringify({
      name: 'renamed proxy', proxyUrl: pools.proxyPools[0].proxyUrl,
    }) });
    const connectionId = plan.payload.providerConnections[0].id;
    await request(`/api/providers/${connectionId}`, { method: 'PUT', body: JSON.stringify({
      name: 'renamed provider', apiKey: '••••••••',
    }) });

    const privilegedSnapshot = await request('/api/settings/database');
    assert.strictEqual(privilegedSnapshot.settings.oidcClientSecret, 'oidc-integration-secret');
    assert.strictEqual(privilegedSnapshot.settings.outboundProxyUrl, 'http://proxy-user:proxy-secret@proxy.example:8080');
    assert.strictEqual(privilegedSnapshot.proxyPools[0].proxyUrl, 'http://pool-user:pool-secret@proxy.example:8181');
    assert.strictEqual(privilegedSnapshot.providerConnections[0].apiKey, 'integration-only-secret');
    assert.strictEqual(privilegedSnapshot.settings.stickyRoundRobinLimit, 7);

    await stopChild(child);
    child = null;
    const dbDir = path.join(dataDir, 'db');
    const databaseBytes = fs.readdirSync(dbDir)
      .filter((name) => /^data\.sqlite(?:-(?:wal|shm))?$/.test(name))
      .map((name) => fs.readFileSync(path.join(dbDir, name)).toString('latin1'))
      .join('');
    for (const secret of ['integration-only-secret', 'oidc-integration-secret', 'proxy-secret', 'pool-secret']) {
      assert(!databaseBytes.includes(secret), `database files contain plaintext ${secret}`);
    }
    assert.strictEqual(fs.statSync(path.join(dataDir, '.proxy-max-master-key')).mode & 0o777, 0o600);
    console.log('unified API security integration passed');
  } finally {
    if (child) await stopChild(child);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

