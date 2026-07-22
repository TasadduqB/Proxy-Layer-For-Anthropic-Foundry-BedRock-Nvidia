#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { materializeRuntimeSource } = require('../src/runtime/unified-source');

function main() {
  const { runtimeDir } = materializeRuntimeSource();
  const vitest = path.join(runtimeDir, 'node_modules', 'vitest', 'vitest.mjs');
  if (!fs.existsSync(vitest)) {
    throw new Error('unified test dependencies are missing. Run `npm run unified:install` first.');
  }

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-max-unified-test-'));
  try {
    const config = path.join(runtimeDir, 'tests', 'vitest.config.js');
    const result = spawnSync(process.execPath, [vitest, 'run', '--config', config], {
      cwd: runtimeDir,
      env: {
        ...process.env,
        CI: '1',
        DATA_DIR: dataDir,
        NEXT_TELEMETRY_DISABLED: '1',
        PROXY_MAX_TEST_OFFLINE: '1',
      },
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = result.status || 1;
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(`[proxy-max] ${error.message}`);
  process.exitCode = 1;
}
