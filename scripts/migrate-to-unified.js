#!/usr/bin/env node
'use strict';

const fs = require('fs');
const {
  applyMigrationPlan,
  buildMigrationPlan,
  readLegacyConfig,
  saveMigrationPlan,
} = require('../src/migration/unified-migration');

function printHelp() {
  console.log(`Proxy-Max → unified migration

Usage:
  npm run unified:migrate:plan
  npm run unified:migrate:apply

The plan command is read-only for both existing Proxy-Max and unified data. It
writes a private 0600 plan plus a secret-free report inside the isolated unified
data directory. Apply is explicit, exports a timestamped backup first, merges
without removing existing unified records, imports transactionally, and verifies.
`);
}

async function main() {
  const command = process.argv[2] || 'plan';
  if (command === '--help' || command === '-h' || command === 'help') {
    printHelp();
    return;
  }
  if (!['plan', 'apply'].includes(command)) throw new Error(`Unknown migration command: ${command}`);

  const { config, source } = readLegacyConfig();
  const plan = buildMigrationPlan(config, { source });
  const files = saveMigrationPlan(plan);
  console.log(JSON.stringify({ ...plan.report, planPath: files.planPath, reportPath: files.reportPath }, null, 2));

  if (command === 'apply') {
    const persisted = JSON.parse(fs.readFileSync(files.planPath, 'utf8'));
    const result = await applyMigrationPlan(persisted);
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch((error) => {
  console.error(`[proxy-max migration] ${error.message}`);
  process.exitCode = 1;
});
