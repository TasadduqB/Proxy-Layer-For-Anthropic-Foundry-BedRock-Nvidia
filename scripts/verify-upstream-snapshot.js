#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  const options = {
    snapshot: 'upstream/router-core',
    manifest: 'docs/parity/upstream-v0.5.40.json',
  };
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (key === '--help' || key === '-h') {
      options.help = true;
      continue;
    }
    if (key !== '--snapshot' && key !== '--manifest') throw new Error(`Unknown argument: ${key}`);
    const value = argv[++index];
    if (!value) throw new Error(`Missing value for ${key}`);
    options[key.slice(2)] = value;
  }
  return options;
}

function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function listFiles(root) {
  const files = [];
  // Runtime/install artifacts are Proxy-Max overlays, not part of the pinned
  // upstream Git tree. Every other extra path remains a verification failure.
  const ignoredRootEntries = new Set(['.next', 'coverage', 'node_modules', 'package-lock.json']);
  function walk(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => compare(a.name, b.name))) {
      if (!prefix && ignoredRootEntries.has(entry.name)) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute, relative);
      else if (entry.isFile() || entry.isSymbolicLink()) files.push({ relative, absolute, symlink: entry.isSymbolicLink() });
      else throw new Error(`Unsupported snapshot entry type: ${relative}`);
    }
  }
  walk(root);
  return files;
}

function contentOf(file) {
  return file.symlink ? Buffer.from(fs.readlinkSync(file.absolute), 'utf8') : fs.readFileSync(file.absolute);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node scripts/verify-upstream-snapshot.js [--snapshot upstream/router-core] [--manifest docs/parity/upstream-v0.5.40.json]');
    return;
  }

  const snapshot = path.resolve(options.snapshot);
  const manifestPath = path.resolve(options.manifest);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const expected = new Map(manifest.files.map(file => [file.path, file]));
  const actual = listFiles(snapshot);
  const errors = [];

  for (const file of actual) {
    const record = expected.get(file.relative);
    if (!record) {
      errors.push(`extra: ${file.relative}`);
      continue;
    }
    expected.delete(file.relative);
    const content = contentOf(file);
    const digest = crypto.createHash('sha256').update(content).digest('hex');
    if (content.length !== record.size) errors.push(`size: ${file.relative} expected ${record.size}, received ${content.length}`);
    if (digest !== record.sha256) errors.push(`sha256: ${file.relative} expected ${record.sha256}, received ${digest}`);
  }
  for (const missing of [...expected.keys()].sort(compare)) errors.push(`missing: ${missing}`);

  if (actual.length !== manifest.summary.totalFiles) {
    errors.push(`count: expected ${manifest.summary.totalFiles}, received ${actual.length}`);
  }
  if (errors.length) throw new Error(`Pinned snapshot verification failed:\n${errors.slice(0, 50).join('\n')}`);
  console.log(`PASS: pinned unified snapshot matches all ${actual.length} manifest files`);
}

try {
  main();
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
}
