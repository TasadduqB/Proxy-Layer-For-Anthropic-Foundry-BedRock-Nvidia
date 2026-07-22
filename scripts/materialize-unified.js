#!/usr/bin/env node
'use strict';

const { materializeRuntimeSource } = require('../src/runtime/unified-source');
const { verifySnapshot } = require('../src/runtime/unified-runtime');

try {
  verifySnapshot();
  const result = materializeRuntimeSource({ force: process.argv.includes('--force') });
  console.log(JSON.stringify({
    ok: true,
    runtimeDir: result.runtimeDir,
    digest: result.digest,
    overlayFiles: result.overlayFiles.length,
    trackedFiles: result.files.length,
    unchanged: result.unchanged,
  }, null, 2));
} catch (error) {
  console.error(`[proxy-max] ${error.message}`);
  process.exitCode = 1;
}
