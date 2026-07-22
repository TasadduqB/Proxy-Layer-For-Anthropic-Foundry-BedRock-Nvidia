'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

function requestJSON(port, method, requestPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      method,
      path: requestPath,
      headers: payload ? {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
      } : {},
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, text, json });
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
}

function closeServer(server) {
  return new Promise(resolve => server && server.listening ? server.close(resolve) : resolve());
}

async function main() {
  const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-max-pool-api-'));
  const oldEnv = { ...process.env };
  let proxy;

  try {
    const first = JSON.parse('{"provider":"azure","model":"same-model","label":"east","priority":1,"endpoint":"https://east.example.test","apiKey":"secret-east","accountId":"account-east","future":{"nested":true},"__proto__":{"polluted":true}}');
    const second = {
      provider: 'azure',
      model: 'same-model',
      label: 'west',
      priority: 10,
      endpoint: 'https://west.example.test',
      apiKey: 'secret-west',
      accountId: 'account-west',
      vendorArray: ['kept', { value: 2 }],
    };

    process.env.PORT = '0';
    process.env.HOST = '127.0.0.1';
    delete process.env.PROXY_MAX_API_KEY;
    delete process.env.PROXY_MAX_ADMIN_TOKEN;
    delete process.env.PROXY_MAX_CORS_ORIGINS;
    process.env.HOME = path.join(isolatedRoot, 'home');
    process.env.USERPROFILE = path.join(isolatedRoot, 'home');
    process.env.PROXY_MAX_DATA_DIR = path.join(isolatedRoot, 'data');
    process.env.PROXY_MAX_CONFIG = path.join(isolatedRoot, 'config.json');
    process.env.PROXY_MAX_LOG_DIR = path.join(isolatedRoot, 'logs');
    process.env.PROXY_MAX_LOG_WRITE_MODE = 'sync';
    process.env.PROXY_MAX_CONFIG_JSON = JSON.stringify({
      provider: 'azure',
      providers: { azure: { model: 'default', apiVersion: '2025-04-01-preview' } },
      pool: [first, second],
      limits: { enabled: false },
    });

    proxy = require('./src/server');
    if (!proxy.server.listening) await new Promise(resolve => proxy.server.once('listening', resolve));
    const port = proxy.server.address().port;

    const initial = await requestJSON(port, 'GET', '/api/pool');
    assert.equal(initial.status, 200, initial.text);
    assert.equal(initial.text.includes('secret-east'), false);
    assert.equal(initial.text.includes('secret-west'), false);
    assert.deepEqual(initial.json.pool.map(entry => entry.apiKey), ['••••••••', '••••••••']);
    assert.deepEqual(initial.json.pool[0].future, { nested: true });
    assert.deepEqual(initial.json.pool[1].vendorArray, ['kept', { value: 2 }]);
    assert.equal(Object.prototype.hasOwnProperty.call(initial.json.pool[0], '__proto__'), true);
    assert.equal({}.polluted, undefined);
    assert.equal(new Set(initial.json.poolKeys).size, 2);
    assert.ok(initial.json.poolKeys.every(key => /^pool:v1:[a-f0-9]{64}$/.test(key)));

    const saved = await requestJSON(port, 'POST', '/api/pool', {
      pool: initial.json.pool,
      poolKeys: initial.json.poolKeys,
    });
    assert.equal(saved.status, 200, saved.text);
    assert.deepEqual(saved.json.poolKeys, initial.json.poolKeys, 'masked credentials must restore to the same identities');
    assert.deepEqual(saved.json.pool[0].future, { nested: true });
    assert.deepEqual(saved.json.pool[1].vendorArray, ['kept', { value: 2 }]);
    assert.equal(saved.text.includes('secret-east'), false);

    for (const placeholder of ['••••••••', '[REDACTED]']) {
      const rejected = await requestJSON(port, 'POST', '/api/pool', {
        pool: [...saved.json.pool, { provider: 'azure', model: `new-${placeholder.length}`, apiKey: placeholder }],
        poolKeys: [...saved.json.poolKeys, null],
      });
      assert.equal(rejected.status, 400, rejected.text);
      assert.equal(rejected.json.code, 'UNMATCHED_MASKED_POOL_VALUE');
      const unchanged = await requestJSON(port, 'GET', '/api/pool');
      assert.equal(unchanged.json.pool.length, 2, 'a rejected placeholder must not mutate CONFIG');
    }

    const config = await requestJSON(port, 'GET', '/api/config');
    assert.equal(config.status, 200, config.text);
    assert.equal(config.text.includes('secret-east'), false);
    assert.equal(config.text.includes('secret-west'), false);
    assert.equal({}.polluted, undefined);
    console.log('pool API integration: PASS');
  } finally {
    await closeServer(proxy && proxy.server);
    await new Promise(resolve => setTimeout(resolve, 350));
    process.env = oldEnv;
    try { fs.rmSync(isolatedRoot, { recursive: true, force: true }); } catch {}
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
