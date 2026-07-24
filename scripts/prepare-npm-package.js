#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { materializeRuntimeSource } = require('../src/runtime/unified-source');

const ROOT = path.resolve(__dirname, '..');
const NPM_RUNTIME_DIR = path.join(ROOT, 'npm-runtime');

function prepareNpmPackage(options = {}) {
  const runtimeDir = path.resolve(options.runtimeDir || NPM_RUNTIME_DIR);
  if (path.dirname(runtimeDir) !== ROOT || path.basename(runtimeDir) !== 'npm-runtime') {
    throw new Error(`Refusing to replace unexpected npm runtime directory: ${runtimeDir}`);
  }
  fs.rmSync(runtimeDir, { recursive: true, force: true });
  const result = materializeRuntimeSource({ runtimeDir, force: true });
  const packagingControlFiles = ['.gitignore', '.npmignore'];
  for (const relativePath of packagingControlFiles) {
    fs.rmSync(path.join(runtimeDir, relativePath), { force: true });
  }
  const sourceStampPath = path.join(runtimeDir, '.proxy-max-source.json');
  const sourceStamp = JSON.parse(fs.readFileSync(sourceStampPath, 'utf8'));
  sourceStamp.files = sourceStamp.files.filter((file) => !packagingControlFiles.includes(file));
  fs.writeFileSync(sourceStampPath, `${JSON.stringify(sourceStamp, null, 2)}\n`, { mode: 0o600 });
  const packageJson = JSON.parse(fs.readFileSync(path.join(runtimeDir, 'package.json'), 'utf8'));
  const rootPackage = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  if (packageJson.version !== rootPackage.version) {
    throw new Error(`npm runtime version ${packageJson.version} does not match package ${rootPackage.version}`);
  }
  return {
    ok: true,
    runtimeDir,
    version: packageJson.version,
    digest: result.digest,
    fileCount: sourceStamp.files.length,
  };
}

if (require.main === module) {
  try {
    const report = JSON.stringify(prepareNpmPackage(), null, 2);
    if (process.env.npm_lifecycle_event === 'prepack') console.error(report);
    else console.log(report);
  } catch (error) {
    console.error(`[proxy-max] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { NPM_RUNTIME_DIR, prepareNpmPackage };
