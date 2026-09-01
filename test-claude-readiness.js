'use strict';

const assert = require('node:assert');
const fs = require('node:fs');

const pkg = require('./package.json');
const {
  inspectClaudeReadiness,
  parseClaudeDoctorOutput,
} = require('./src/install');

const parsed = parseClaudeDoctorOutput([
  'Claude Code doctor',
  'Running: native (2.1.220)',
  'Search: OK (bundled)',
  'No installation issues found.',
].join('\n'));

assert.deepStrictEqual(parsed, {
  nativeInstall: true,
  searchReady: true,
  noInstallationIssues: true,
});
assert.strictEqual(pkg.scripts.postinstall, 'node src/install.js --package-install');
assert.strictEqual(pkg.optionalDependencies['@anthropic-ai/claude-code'], '2.1.220');
assert(fs.existsSync('src/install.js'));

const webCliModels = fs.readFileSync('overlays/unified/src/shared/constants/cliTools.js', 'utf8');
const terminalCliModels = fs.readFileSync('overlays/unified/cli/src/cli/menus/cliTools.js', 'utf8');
const terminalClaudeDefaults = terminalCliModels.match(/const CLAUDE_MODEL_TYPES = \[([\s\S]*?)\];/)?.[1] || '';
for (const model of [
  'cc/claude-fable-5',
  'cc/claude-opus-4-8',
  'cc/claude-sonnet-5',
  'cc/claude-haiku-4-5-20251001',
]) {
  assert(webCliModels.includes(model), `web Claude setup is missing ${model}`);
  assert(terminalCliModels.includes(model), `terminal Claude setup is missing ${model}`);
}
for (const retiredModel of [
  'cc/claude-sonnet-4-5-20250929',
  'cc/claude-opus-4-5-20251101',
]) {
  assert(!terminalClaudeDefaults.includes(retiredModel), `terminal Claude setup still uses ${retiredModel}`);
}

const readiness = inspectClaudeReadiness();
for (const field of [
  'ready',
  'claude',
  'version',
  'shell',
  'git',
  'ripgrep',
  'python',
  'doctorOk',
  'searchReady',
  'nativeInstall',
  'issues',
]) {
  assert(Object.hasOwn(readiness, field), `readiness report missing ${field}`);
}
assert(Array.isArray(readiness.issues));

console.log('claude readiness tests passed');
