'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const PINNED_SOURCE_DIR = path.join(ROOT, 'upstream', 'router-core');
const OVERLAY_DIR = path.join(ROOT, 'overlays', 'unified');
const RUNTIME_PROJECT_DIR = path.join(ROOT, '.proxy-max', 'runtime', 'unified');
const PARITY_MANIFEST = path.join(ROOT, 'docs', 'parity', 'upstream-v0.5.40.json');
const MATERIALIZATION_STAMP = '.proxy-max-source.json';

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function normalizeRelativePath(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) throw new Error(`Invalid materialized path: ${value}`);
  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new Error(`Unsafe materialized path: ${value}`);
  if (parts.some((part) => ['.git', '.next', 'node_modules'].includes(part))) throw new Error(`Generated-only path cannot be overlaid: ${value}`);
  return normalized;
}

function inside(root, relativePath) {
  const target = path.resolve(root, ...normalizeRelativePath(relativePath).split('/'));
  const prefix = `${path.resolve(root)}${path.sep}`;
  if (!target.startsWith(prefix)) throw new Error(`Path escapes materialized root: ${relativePath}`);
  return target;
}

function listFiles(directory, prefix = '') {
  if (!fs.existsSync(directory)) return [];
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Overlay symlinks are not allowed: ${relativePath}`);
    if (entry.isDirectory()) output.push(...listFiles(path.join(directory, entry.name), relativePath));
    else if (entry.isFile()) output.push(normalizeRelativePath(relativePath));
    else throw new Error(`Unsupported overlay entry: ${relativePath}`);
  }
  return output;
}

function loadPinnedFiles() {
  const manifest = JSON.parse(fs.readFileSync(PARITY_MANIFEST, 'utf8'));
  if (!Array.isArray(manifest.files) || manifest.files.length !== 1342) {
    throw new Error('Pinned parity manifest is missing or has an unexpected file count.');
  }
  return {
    source: manifest.source,
    files: manifest.files.map((entry) => normalizeRelativePath(entry.path)),
  };
}

function copyFile(source, destination) {
  const stat = fs.statSync(source);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  try { fs.chmodSync(destination, stat.mode & 0o777); } catch { /* best effort */ }
}

function removeFormerFiles(runtimeDir, former, desired) {
  const desiredSet = new Set(desired);
  for (const relativePath of former || []) {
    if (desiredSet.has(relativePath)) continue;
    const target = inside(runtimeDir, relativePath);
    try { fs.unlinkSync(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function materializationDigest(pinned, overlays, packageLockPath, overlayDir = OVERLAY_DIR) {
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify(pinned.source));
  for (const relativePath of overlays) {
    hash.update(relativePath);
    hash.update(sha256File(inside(overlayDir, relativePath)));
  }
  hash.update('package-lock.json');
  hash.update(sha256File(packageLockPath));
  return hash.digest('hex');
}

function materializeRuntimeSource(options = {}) {
  const runtimeDir = path.resolve(options.runtimeDir || RUNTIME_PROJECT_DIR);
  const sourceDir = path.resolve(options.sourceDir || PINNED_SOURCE_DIR);
  const overlayDir = path.resolve(options.overlayDir || OVERLAY_DIR);
  const pinned = loadPinnedFiles();
  const overlayFiles = listFiles(overlayDir);
  const packageLockPath = path.join(sourceDir, 'package-lock.json');
  if (!fs.existsSync(packageLockPath)) throw new Error('Proxy-Max unified package-lock overlay is missing.');
  const digestValue = materializationDigest(pinned, overlayFiles, packageLockPath, overlayDir);
  const desiredFiles = [...new Set([...pinned.files, 'package-lock.json', ...overlayFiles])].sort();
  const stampPath = path.join(runtimeDir, MATERIALIZATION_STAMP);

  let former = null;
  try { former = JSON.parse(fs.readFileSync(stampPath, 'utf8')); } catch { /* first materialization */ }
  if (!options.force && former?.digest === digestValue && former?.files?.length === desiredFiles.length) {
    const complete = desiredFiles.every((relativePath) => fs.existsSync(inside(runtimeDir, relativePath)));
    if (complete) return { ...former, runtimeDir, unchanged: true };
  }

  fs.mkdirSync(runtimeDir, { recursive: true });
  removeFormerFiles(runtimeDir, former?.files, desiredFiles);
  for (const relativePath of pinned.files) {
    copyFile(inside(sourceDir, relativePath), inside(runtimeDir, relativePath));
  }
  copyFile(packageLockPath, path.join(runtimeDir, 'package-lock.json'));
  for (const relativePath of overlayFiles) {
    copyFile(inside(overlayDir, relativePath), inside(runtimeDir, relativePath));
  }

  const stamp = {
    schemaVersion: 1,
    digest: digestValue,
    source: pinned.source,
    overlayFiles,
    files: desiredFiles,
  };
  fs.writeFileSync(stampPath, `${JSON.stringify(stamp, null, 2)}\n`, { mode: 0o600 });
  return { ...stamp, runtimeDir, unchanged: false };
}

module.exports = {
  ROOT,
  PINNED_SOURCE_DIR,
  OVERLAY_DIR,
  RUNTIME_PROJECT_DIR,
  PARITY_MANIFEST,
  normalizeRelativePath,
  listFiles,
  loadPinnedFiles,
  materializeRuntimeSource,
};
