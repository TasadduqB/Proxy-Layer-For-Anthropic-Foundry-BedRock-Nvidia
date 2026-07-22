'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildMigrationPlan, applyMigrationPlan } = require('./src/migration/unified-migration');
const { runtimeStatus } = require('./src/runtime/unified-runtime');

(async () => {
  if (!runtimeStatus().ready) {
    console.log('unified migration integration skipped (standalone build not installed)');
    return;
  }

  const temporaryDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-max-migration-integration-'));
  try {
    const plan = buildMigrationPlan({
      provider: 'nvidia',
      providers: {
        nvidia: {
          model: 'nvidia/nemotron-3-ultra-550b-a55b',
          endpoint: 'https://integrate.api.nvidia.com/v1',
          apiKey: 'integration-only-secret',
        },
      },
    }, { source: 'integration-fixture' });
    const result = await applyMigrationPlan(plan, { dataDir: temporaryDataDir, stdio: ['ignore', 'ignore', 'pipe'] });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.importedConnections, 1);
    assert.strictEqual(result.importedCombos, 1);
    assert(fs.existsSync(result.backupPath));
    assert.strictEqual(fs.statSync(result.backupPath).mode & 0o777, 0o600);
    assert(fs.existsSync(path.join(temporaryDataDir, 'db', 'data.sqlite')));
    assert.strictEqual(fs.statSync(path.join(temporaryDataDir, 'db')).mode & 0o777, 0o700);
    assert.strictEqual(fs.statSync(path.join(temporaryDataDir, 'db', 'data.sqlite')).mode & 0o777, 0o600);
    console.log('unified migration integration passed');
  } finally {
    fs.rmSync(temporaryDataDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
