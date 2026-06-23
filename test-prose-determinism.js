// Settles the "prose compression is non-deterministic" concern with evidence.
// Compression is pure regex replacement: same input must always produce the
// same output (so it never churns prompt-cache prefixes), and re-compressing
// already-compressed text must be stable (idempotent-ish, no further drift).
const assert = require('assert');
const ProseCompressor = require('./src/compression/prose-compressor');

const c = new ProseCompressor();
let failures = 0;
function run(name, fn) {
  try { fn(); console.log('PASS  ' + name); }
  catch (e) { failures++; console.log('FAIL  ' + name + ': ' + e.message); }
}

const sample = 'I would just really like to actually basically help you with that, of course. ' +
  'The function `doThing()` will simply return the value. Here is some code:\n' +
  '```js\nconst x = 1; // just a value\n```\nThanks so much!';

for (const mode of ['lite', 'full', 'ultra']) {
  run(`deterministic across runs (${mode})`, () => {
    const a = c.compress(sample, mode);
    const b = c.compress(sample, mode);
    assert.strictEqual(a, b, 'same input must yield identical output');
  });
  run(`stable on recompress (${mode})`, () => {
    const once = c.compress(sample, mode);
    const twice = c.compress(once, mode);
    assert.strictEqual(once, twice, 'recompressing must not drift');
  });
  run(`preserves code block (${mode})`, () => {
    const out = c.compress(sample, mode);
    assert.ok(out.includes('const x = 1'), 'code content must survive');
  });
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
