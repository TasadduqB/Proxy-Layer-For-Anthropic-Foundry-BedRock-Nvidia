// Focused test: the heuristic token counter must be in the right ballpark.
// Real tokenizers average ~4 chars/token for English prose. The estimator
// must not wildly overcount (it was charging ~1.13 tokens PER LETTER).
const assert = require('assert');
const TokenCounter = require('./src/token-analyzer/counter');

const tc = new TokenCounter();
let failures = 0;
function check(name, text, lo, hi, provider = 'anthropic') {
  const n = tc.estimateTokens(text, { provider });
  const ok = n >= lo && n <= hi;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${n} tokens (expected ${lo}-${hi})  [${text.length} chars]`);
}

// "Hello world" is ~2 real tokens. Allow generous slack but reject 10+.
check('hello world', 'Hello world', 1, 5);

// A realistic English paragraph (~440 chars) is ~90-120 real tokens (chars/4).
const para = 'The quick brown fox jumps over the lazy dog. '.repeat(10); // 450 chars
check('paragraph ~450 chars', para, 80, 160);

// A code-ish system prompt chunk: chars/4 ballpark, not 4x that.
const codey = 'function add(a, b) { return a + b; } '.repeat(20); // ~740 chars
check('code ~740 chars', codey, 130, 300);

// Pure digits: a 30-digit string is ~10-15 tokens, not 50+.
check('30 digits', '1'.repeat(30), 5, 25);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
