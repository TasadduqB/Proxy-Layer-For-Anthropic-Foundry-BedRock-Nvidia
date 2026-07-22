'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { main } = require('./scripts/reset-unified-password');

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-max-recovery-test-'));
  try {
    fs.mkdirSync(path.join(dataDir, 'auth'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'machine-id'), 'machine-test\n');
    fs.writeFileSync(path.join(dataDir, 'auth', 'cli-secret'), 'secret-test\n');
    const expectedToken = crypto
      .createHash('sha256')
      .update('machine-test9r-cli-authsecret-test')
      .digest('hex')
      .slice(0, 16);
    let request;
    let message = '';
    await main({
      env: {
        PROXY_MAX_UNIFIED_DATA_DIR: dataDir,
        PROXY_MAX_UNIFIED_HOST: '127.0.0.1',
        PROXY_MAX_UNIFIED_PORT: '18787',
      },
      fetchImpl: async (url, options) => {
        request = { url, options };
        return { ok: true, status: 200 };
      },
      log: value => { message = value; },
    });
    assert.strictEqual(request.url, 'http://127.0.0.1:18787/api/auth/reset-password');
    assert.strictEqual(request.options.method, 'POST');
    assert.strictEqual(request.options.headers['x-9r-cli-token'], expectedToken);
    assert.match(message, /set a new password immediately/);

    await assert.rejects(
      () => main({
        env: {
          PROXY_MAX_UNIFIED_DATA_DIR: dataDir,
          PROXY_MAX_UNIFIED_HOST: 'example.com',
        },
        fetchImpl: async () => ({ ok: true }),
      }),
      /loopback/,
    );
    console.log('unified password recovery tests passed');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
