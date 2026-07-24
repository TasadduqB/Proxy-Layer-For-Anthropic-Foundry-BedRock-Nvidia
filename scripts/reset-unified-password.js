#!/usr/bin/env node
'use strict';

const { deriveCliToken } = require('../src/runtime/cli-auth');
const { parsePort, resolveDataDir } = require('../src/runtime/unified-runtime');

async function main(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const log = options.log || console.log;
  const dataDir = resolveDataDir(env);
  let cliToken;
  try {
    cliToken = deriveCliToken(dataDir);
  } catch {
    throw new Error('Unified runtime authentication files were not found. Start Proxy Max once, then retry.');
  }

  const host = String(env.PROXY_MAX_UNIFIED_HOST || '127.0.0.1').trim() || '127.0.0.1';
  const port = parsePort(env.PROXY_MAX_UNIFIED_PORT || env.PORT, 8787);
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error('Password recovery only connects to a loopback Proxy Max host.');
  }

  const response = await fetchImpl(`http://${host.includes(':') ? `[${host}]` : host}:${port}/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'x-9r-cli-token': cliToken },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Password recovery failed with HTTP ${response.status}.`);
  log('Proxy Max dashboard password reset. Sign in with 123456 and set a new password immediately.');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[proxy-max] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main };
