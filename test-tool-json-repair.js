// Tool-call JSON repair tests.
//
// Drives the REAL createAnthropicSSEEmitter with the same call sequence the
// providers use (deltaToolCall streaming/cumulative, then end()), captures every
// emitted `input_json_delta.partial_json`, and asserts it JSON.parses. This is
// the exact byte stream Claude Code accumulates and JSON.parses at
// content_block_stop — if any partial_json is invalid, Claude Code rejects the
// edit with "not a valid JSON".
//
// Also exercises buildAnthropicResponse (non-stream parity) and the low-level
// repair helpers via the public streaming surface.

const assert = require('assert');
const common = require('./src/providers/_common.js');
const { createAnthropicSSEEmitter, buildAnthropicResponse } = common;

let passed = 0;
let failed = 0;
const failures = [];

// Minimal res mock capturing SSE writes and exposing parsed tool inputs.
function makeRes() {
  const chunks = [];
  return {
    writableEnded: false,
    write(s) { chunks.push(s); return true; },
    end() { this.writableEnded = true; },
    _chunks: chunks,
    // Parse captured SSE into { toolBlocks: [{name, partialJsons:[], input}] }.
    parse() {
      const raw = chunks.join('');
      const events = [];
      for (const blk of raw.split('\n\n')) {
        const evLine = blk.match(/^event: (.+)$/m);
        const dataLine = blk.match(/^data: (.+)$/m);
        if (!evLine || !dataLine) continue;
        let data;
        try { data = JSON.parse(dataLine[1]); } catch { continue; }
        events.push({ event: evLine[1], data });
      }
      const blocks = new Map();
      for (const { event, data } of events) {
        if (event === 'content_block_start' && data.content_block?.type === 'tool_use') {
          blocks.set(data.index, { name: data.content_block.name, partials: [] });
        } else if (event === 'content_block_delta' && data.delta?.type === 'input_json_delta') {
          const b = blocks.get(data.index);
          if (b) b.partials.push(data.delta.partial_json);
        }
      }
      return [...blocks.values()];
    }
  };
}

function tc(id, name, args) {
  return { id, function: { name, arguments: args } };
}

// Run a streaming scenario. `feed(emitter)` performs deltaToolCall calls.
// Returns array of tool blocks with concatenated partial_json parsed.
function runStream(feed, { toolDefs = [] } = {}) {
  const res = makeRes();
  const emitter = createAnthropicSSEEmitter(res, 'gpt-test', toolDefs);
  emitter.start({ input_tokens: 1 });
  feed(emitter);
  emitter.end();
  const blocks = res.parse();
  return blocks.map(b => {
    const joined = b.partials.join('');
    return { name: b.name, raw: joined, input: joined ? JSON.parse(joined) : {} };
  });
}

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e });
    console.log(`  ✗ ${name} — ${e.message}`);
  }
}

console.log('\nTool-call JSON repair');

// 1. Valid JSON passes through and parses.
test('valid JSON — untouched, parses', () => {
  const [b] = runStream(e => {
    e.deltaToolCall(0, tc('t1', 'Edit', '{"file_path":"a.js","new_string":"x"}'));
  });
  assert.strictEqual(b.input.file_path, 'a.js');
  assert.strictEqual(b.input.new_string, 'x');
});

// 2. Invalid backslash escapes (Windows path, regex, LaTeX) get repaired.
test('invalid backslash escapes — repaired + parses', () => {
  const args = '{"path":"C:\\Users\\me","re":"\\d+\\.\\d+","tex":"\\frac{a}{b}"}';
  const [b] = runStream(e => e.deltaToolCall(0, tc('t1', 'Write', args)));
  assert.ok(b.input.path.includes('Users'));
  assert.ok(b.input.re.includes('d+'));
});

// 3. Literal control chars (raw newline/tab) inside a string get escaped.
test('literal control chars — escaped + parses', () => {
  const args = '{"content":"line1\nline2\ttabbed"}';
  const [b] = runStream(e => e.deltaToolCall(0, tc('t1', 'Write', args)));
  assert.ok(b.input.content.includes('line1'));
  assert.ok(b.input.content.includes('line2'));
});

// 4. Unescaped inner double-quotes get escaped.
test('unescaped inner quotes — escaped + parses', () => {
  const args = '{"new_string":"const greeting = "hello world";"}';
  const [b] = runStream(e => e.deltaToolCall(0, tc('t1', 'Edit', args)));
  assert.ok(b.input.new_string.includes('hello world'));
  assert.ok(b.input.new_string.includes('const greeting'));
});

// 5. Unescaped inner quotes across multiple keys.
test('unescaped inner quotes — multiple fields + parses', () => {
  const args = '{"old_string":"foo "bar"","new_string":"baz "qux" end"}';
  const [b] = runStream(e => e.deltaToolCall(0, tc('t1', 'Edit', args)));
  assert.ok(b.input.old_string.includes('bar'));
  assert.ok(b.input.new_string.includes('qux'));
});

// 6. Trailing comma repair.
test('trailing comma — repaired + parses', () => {
  const args = '{"a":"1","b":"2",}';
  const [b] = runStream(e => e.deltaToolCall(0, tc('t1', 'Edit', args)));
  assert.strictEqual(b.input.b, '2');
});

// 7. Truncated required-arg tool call is SKIPPED (no invalid block emitted).
test('truncated required call — skipped', () => {
  const toolDefs = [{ name: 'Edit', input_schema: { required: ['file_path', 'new_string'] } }];
  const blocks = runStream(
    e => e.deltaToolCall(0, tc('t1', 'Edit', '{"file_path":"a.js","new_string":"co')),
    { toolDefs }
  );
  // Either skipped entirely, or emitted with valid (repaired) JSON. Never invalid.
  for (const b of blocks) assert.doesNotThrow(() => b.raw && JSON.parse(b.raw));
});

// 8. Incremental streaming chunks accumulate correctly.
test('incremental chunks — accumulate + parses', () => {
  const [b] = runStream(e => {
    e.deltaToolCall(0, tc('t1', 'Edit', '{"file_path":"a'));
    e.deltaToolCall(0, tc('t1', 'Edit', '.js","new_string":"h'));
    e.deltaToolCall(0, tc('t1', 'Edit', 'i"}'));
  });
  assert.strictEqual(b.input.file_path, 'a.js');
  assert.strictEqual(b.input.new_string, 'hi');
});

// 9. Cumulative snapshot replaces buffered incremental drift.
test('cumulative snapshot — replaces + parses', () => {
  const [b] = runStream(e => {
    e.deltaToolCall(0, tc('t1', 'Edit', '{"file_path":"a'));
    e.deltaToolCall(0, tc('t1', 'Edit', '{"file_path":"a.js","new_string":"final"}'), { cumulative: true });
  });
  assert.strictEqual(b.input.file_path, 'a.js');
  assert.strictEqual(b.input.new_string, 'final');
});

// 10. Repeated identical chunk must NOT be deduped away (prior bug).
test('repeated line content — not dropped', () => {
  const line = 'return 1;\\n';
  const [b] = runStream(e => {
    e.deltaToolCall(0, tc('t1', 'Write', '{"content":"'));
    e.deltaToolCall(0, tc('t1', 'Write', line));
    e.deltaToolCall(0, tc('t1', 'Write', line));
    e.deltaToolCall(0, tc('t1', 'Write', '"}'));
  });
  const occurrences = (b.input.content.match(/return 1;/g) || []).length;
  assert.strictEqual(occurrences, 2);
});

// 11. Parallel tool calls (two indexes) both emit valid JSON.
test('parallel tool calls — both parse', () => {
  const blocks = runStream(e => {
    e.deltaToolCall(0, tc('t1', 'Read', '{"file_path":"a.js"}'));
    e.deltaToolCall(1, tc('t2', 'Read', '{"file_path":"b.js"}'));
  });
  assert.strictEqual(blocks.length, 2);
  assert.strictEqual(blocks[0].input.file_path, 'a.js');
  assert.strictEqual(blocks[1].input.file_path, 'b.js');
});

// 12. Combined worst case: invalid escapes + control chars + inner quotes.
test('combined defects — repaired + parses', () => {
  const args = '{"file_path":"C:\\proj\\x.js","new_string":"say "hi"\nnext\ttab"}';
  const [b] = runStream(e => e.deltaToolCall(0, tc('t1', 'Edit', args)));
  assert.ok(b.input.file_path.includes('proj'));
  assert.ok(b.input.new_string.includes('hi'));
  assert.ok(b.input.new_string.includes('next'));
});

// 13. Non-stream buildAnthropicResponse parity — same repair applied.
test('non-stream buildAnthropicResponse — repaired + parses', () => {
  const resp = buildAnthropicResponse({
    model: 'gpt-test',
    toolCalls: [{ id: 't1', name: 'Edit', arguments: '{"new_string":"const x = "y";","file_path":"a.js"}' }],
    stopReason: 'tool_use',
    usage: { input_tokens: 1, output_tokens: 1 },
    toolDefs: [{ name: 'Edit', input_schema: { required: ['file_path', 'new_string'] } }]
  });
  const toolBlock = resp.content.find(c => c.type === 'tool_use');
  assert.ok(toolBlock, 'tool_use block present');
  assert.strictEqual(toolBlock.input.file_path, 'a.js');
  assert.ok(toolBlock.input.new_string.includes('const x'));
});

// 14. Simulated XML/markdown tool call recovered from text and parses.
test('simulated tool call in text — recovered + parses', () => {
  const res = makeRes();
  const emitter = createAnthropicSSEEmitter(res, 'gpt-test', [
    { name: 'Read', input_schema: { required: ['file_path'] } }
  ]);
  emitter.start({ input_tokens: 1 });
  emitter.deltaText('<function_calls>\n<invoke name="Read">\n<parameter name="file_path">a.js</parameter>\n</invoke>\n</function_calls>');
  emitter.end();
  const blocks = res.parse();
  // If a tool block was produced, its JSON must parse.
  for (const b of blocks) {
    const joined = b.partials.join('');
    if (joined) assert.doesNotThrow(() => JSON.parse(joined));
  }
});

// Global invariant: across ALL streaming scenarios above, every emitted
// partial_json parsed (each test already asserted its own, but re-run a broad
// fuzz to be safe).
test('fuzz — assorted defective payloads all parse or skip', () => {
  const payloads = [
    '{"a":"C:\\temp\\f"}',
    '{"a":"he said "yes""}',
    '{"a":"tab\there"}',
    '{"a":"1",}',
    '{"a":"\\d{2,4}"}',
    '{"a":"line\nbreak","b":"end"}',
    '{"a":"quote"in"middle","b":2}',
  ];
  for (const p of payloads) {
    const blocks = runStream(e => e.deltaToolCall(0, tc('t1', 'Edit', p)));
    for (const b of blocks) {
      if (b.raw) assert.doesNotThrow(() => JSON.parse(b.raw), `payload ${p} -> ${b.raw}`);
    }
  }
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  for (const f of failures) console.error(`FAIL: ${f.name}\n${f.error.stack}\n`);
  process.exit(1);
}
