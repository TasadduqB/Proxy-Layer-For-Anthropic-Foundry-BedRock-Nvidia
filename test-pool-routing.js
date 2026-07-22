'use strict';

const assert = require('node:assert/strict');
const {
  normalizePriority,
  comparePoolPriority,
  normalizePoolEntries,
  serializePoolEntries,
  restoreMaskedValues,
  resolvePoolMember,
  poolMemberKey,
  statsKeyForMember,
  normalizeCursor,
  advanceRoundRobinCursor,
  selectPoolMember,
  createPoolRequestSelector,
  buildPoolStatsSnapshot,
} = require('./src/routing/pool-routing');

let failures = 0;
function run(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    failures++;
    console.log(`FAIL  ${name}: ${error.stack || error.message}`);
  }
}

function member(model, priority, extra = {}) {
  return {
    provider: 'azure',
    model,
    endpoint: `https://${model}.example.test`,
    deployment: model,
    priority,
    ...extra,
  };
}

run('a request never retries the same logical member', () => {
  const pool = [member('a', 10), member('b', 10), member('c', 10)];
  const request = createPoolRequestSelector(pool, { cursor: 0 });
  const attempts = [request.next(), request.next(), request.next()];
  assert.ok(attempts.every(Boolean));
  assert.equal(new Set(attempts.map(attempt => attempt.key)).size, 3);
  assert.equal(request.next(), null);
  assert.equal(request.getAttemptedKeys().size, 3);
});

run('exact duplicate entries are attempted only once', () => {
  const duplicate = member('same', 1, { apiKey: 'duplicate-secret' });
  const request = createPoolRequestSelector([duplicate, { ...duplicate }]);
  assert.ok(request.next());
  assert.equal(request.next(), null);
});

run('lower numeric priority wins and fallback walks upward', () => {
  assert.equal(normalizePriority(0), 0);
  assert.ok(comparePoolPriority({ priority: 1 }, { priority: 2 }) < 0);
  const pool = [member('low', 50), member('highest', 1), member('middle', 10)];
  const request = createPoolRequestSelector(pool, { cursor: 0 });
  assert.equal(request.next().member.model, 'highest');
  assert.equal(request.next().member.model, 'middle');
  assert.equal(request.next().member.model, 'low');
});

run('cooldown members are filtered using the shared stats key', () => {
  const now = 1_000_000;
  const cooled = member('cooled', 1);
  const ready = member('ready', 2);
  const stats = new Map([
    [statsKeyForMember(cooled), { cooledUntil: now + 30_000 }],
  ]);
  const selected = selectPoolMember([cooled, ready], { stats, now });
  assert.equal(selected.member.model, 'ready');
  assert.equal(selectPoolMember([cooled], { stats, now }), null);
});

run('saturated, excluded, and already-attempted members are filtered', () => {
  const saturated = member('saturated', 1);
  const excluded = member('excluded', 2);
  const attempted = member('attempted', 3);
  const ready = member('ready', 4);
  const stats = new Map([
    [statsKeyForMember(saturated), { inFlight: 2 }],
  ]);
  const selected = selectPoolMember([saturated, excluded, attempted, ready], {
    stats,
    perMemberCapacity: 2,
    excludedKeys: new Set([statsKeyForMember(excluded)]),
    attemptedKeys: new Set([statsKeyForMember(attempted)]),
  });
  assert.equal(selected.member.model, 'ready');
});

run('round robin is stable among equal-priority members and wraps safely', () => {
  const pool = [member('a', 10), member('b', 10), member('c', 10)];
  const first = createPoolRequestSelector(pool, { cursor: 0 }).next();
  const second = createPoolRequestSelector(pool, { cursor: first.nextCursor }).next();
  const third = createPoolRequestSelector(pool, { cursor: second.nextCursor }).next();
  const wrapped = createPoolRequestSelector(pool, { cursor: third.nextCursor }).next();
  assert.deepEqual(
    [first.member.model, second.member.model, third.member.model, wrapped.member.model],
    ['a', 'b', 'c', 'a'],
  );
  assert.equal(normalizeCursor(-1, 3), 2);
  assert.equal(advanceRoundRobinCursor(99, 2, 3), 0);
  assert.equal(advanceRoundRobinCursor(99, 2, 0), 0);
});

run('same provider/model stays distinct across endpoints and accounts', () => {
  const base = { provider: 'azure', model: 'gpt-5', deployment: 'primary', apiKey: 'same-secret' };
  const endpointA = { ...base, endpoint: 'https://east.example.test', accountId: 'account-a' };
  const endpointB = { ...base, endpoint: 'https://west.example.test', accountId: 'account-b' };
  const keyA = poolMemberKey(endpointA);
  const keyB = poolMemberKey(endpointB);
  assert.notEqual(keyA, keyB);

  const request = createPoolRequestSelector([endpointA, endpointB]);
  const selectedKeys = new Set([request.next().key, request.next().key]);
  assert.deepEqual(selectedKeys, new Set([keyA, keyB]));
});

run('credential identity affects the opaque key without exposing the secret', () => {
  const first = member('secure', 1, { apiKey: 'very-secret-one' });
  const second = member('secure', 1, { apiKey: 'very-secret-two' });
  const firstKey = poolMemberKey(first);
  assert.notEqual(firstKey, poolMemberKey(second));
  assert.equal(firstKey.includes(first.apiKey), false);
  assert.match(firstKey, /^pool:v1:[a-f0-9]{64}$/);
});

run('provider defaults participate in stable effective identity', () => {
  const entry = { provider: 'azure', model: 'gpt-5' };
  const east = { azure: { endpoint: 'https://east.example.test', accountId: 'a', apiKey: 'secret' } };
  const west = { azure: { endpoint: 'https://west.example.test', accountId: 'a', apiKey: 'secret' } };
  assert.notEqual(poolMemberKey(entry, east), poolMemberKey(entry, west));
  assert.equal(poolMemberKey(entry, east), poolMemberKey(entry, east));
  const hydrated = resolvePoolMember(entry, east);
  hydrated._key = poolMemberKey(entry, east);
  const selected = createPoolRequestSelector([hydrated]).next();
  assert.equal(selected.key, hydrated._key, 'hydrated and source entries must have the identical effective key');
});

run('normalization treats prototype-shaped JSON keys as inert own data', () => {
  const original = JSON.parse('{"provider":"azure","model":"safe","__proto__":{"polluted":true},"constructor":{"kept":1},"prototype":{"kept":2},"nested":{"__proto__":{"deep":true}}}');
  const normalized = normalizePoolEntries([original])[0];
  const saved = serializePoolEntries([normalized])[0];
  assert.equal({}.polluted, undefined);
  assert.equal({}.deep, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized, '__proto__'), true);
  assert.equal(Object.prototype.hasOwnProperty.call(saved.nested, '__proto__'), true);
  assert.deepEqual(normalized.__proto__, { polluted: true });
  assert.deepEqual(saved.constructor, { kept: 1 });
  assert.deepEqual(saved.prototype, { kept: 2 });
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), original);
});

run('masked values restore only from matching previous data', () => {
  const previous = JSON.parse('{"apiKey":"real-secret","nested":{"token":"nested-secret"},"__proto__":{"credential":"prototype-secret"}}');
  const incoming = JSON.parse('{"apiKey":"••••••••","nested":{"token":"[REDACTED]"},"__proto__":{"credential":"••••••••"}}');
  const restored = restoreMaskedValues(incoming, previous, { path: 'pool[0]' });
  assert.deepEqual(restored.unmatchedPaths, []);
  assert.equal(restored.value.apiKey, 'real-secret');
  assert.equal(restored.value.nested.token, 'nested-secret');
  assert.equal(restored.value.__proto__.credential, 'prototype-secret');
  assert.equal({}.credential, undefined);

  const unmatched = restoreMaskedValues({ apiKey: '[REDACTED]' }, {}, { path: 'pool[1]' });
  assert.deepEqual(unmatched.unmatchedPaths, ['pool[1].apiKey']);
  assert.equal(unmatched.value.apiKey, '[REDACTED]');
});

run('normalization and serialization preserve every unknown field', () => {
  const original = [{
    provider: 'Azure',
    model: '  gpt-custom  ',
    priority: '7',
    futureFlag: true,
    vendorOptions: {
      nested: ['one', { two: 2 }],
      arbitraryCredentialReference: 'vault://connection/name',
    },
    customHeaders: { 'x-experimental': 'enabled' },
  }];
  const normalized = normalizePoolEntries(original);
  assert.equal(normalized[0].provider, 'azure');
  assert.equal(normalized[0].model, 'gpt-custom');
  assert.equal(normalized[0].priority, 7);
  assert.deepEqual(normalized[0].vendorOptions, original[0].vendorOptions);
  assert.deepEqual(normalized[0].customHeaders, original[0].customHeaders);
  assert.notEqual(normalized[0].vendorOptions, original[0].vendorOptions);

  const saved = serializePoolEntries(normalized);
  assert.deepEqual(saved, normalized);
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), saved);
});

run('runtime and UI snapshots use the same deterministic stats key', () => {
  const entry = member('stats', 3, { accountId: 'stats-account', apiKey: 'stats-secret' });
  const runtimeKey = statsKeyForMember(entry);
  const stats = new Map([[runtimeKey, { req: 4, err: 1, inFlight: 1, capacity: 3 }]]);
  const snapshot = buildPoolStatsSnapshot([entry], { stats, now: 100 });
  assert.equal(snapshot[0].key, runtimeKey);
  assert.equal(snapshot[0].statsKey, runtimeKey);
  assert.equal(snapshot[0].stats.req, 4);
  assert.equal(snapshot[0].stats.available, 2);
  assert.equal(JSON.stringify(snapshot).includes(entry.apiKey), false);
});

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
