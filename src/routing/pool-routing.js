'use strict';

const crypto = require('node:crypto');

const DEFAULT_PRIORITY = 100;
const KEY_DOMAIN = 'proxy-max/pool-member/v1';

// These fields identify the upstream connection a logical pool member uses.
// The final identity is hashed, so endpoints, account identifiers, and
// credentials never appear in the key exposed to logs or the dashboard.
const CONNECTION_IDENTITY_FIELDS = Object.freeze([
  'id',
  'memberId',
  'connectionId',
  'provider',
  'kind',
  'model',
  'endpoint',
  'baseUrl',
  'baseURL',
  'deployment',
  'apiVersion',
  'region',
  'service',
  'host',
  'account',
  'accountId',
  'accountName',
  'tenantId',
  'subscriptionId',
  'project',
  'projectId',
  'organization',
  'organizationId',
  'resourceGroup',
  'resourceName',
  'credentialId',
]);

const CREDENTIAL_FIELD_NAMES = new Set([
  'apikey',
  'accesskey',
  'accesskeyid',
  'secretkey',
  'secretaccesskey',
  'sessiontoken',
  'token',
  'authtoken',
  'accesstoken',
  'refreshtoken',
  'password',
  'clientsecret',
  'clientid',
  'privatekey',
  'credential',
  'credentials',
  'credentialid',
  'auth',
  'apikeys',
  'accesskeys',
  'tokens',
  'secrets',
  'passwords',
  'bearertoken',
  'subscriptionkey',
  'username',
  'secret',
]);

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function defineOwn(object, key, value) {
  Object.defineProperty(object, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
  return object;
}

function cloneConfigValue(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  if (value instanceof Date) return new Date(value.getTime());
  if (Buffer.isBuffer(value)) return Buffer.from(value);

  const clone = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value) === null ? null : Object.prototype);
  seen.set(value, clone);
  for (const key of Object.keys(value)) defineOwn(clone, key, cloneConfigValue(value[key], seen));
  return clone;
}

function normalizeProvider(value) {
  if (value == null) return '';
  return String(value).trim().toLowerCase();
}

function normalizeModel(value) {
  if (value == null) return '';
  return String(value).trim();
}

/**
 * Convert a priority to its routing value. Lower numbers are always higher
 * priority; equal priorities are resolved by round-robin order.
 */
function normalizePriority(value, fallback = DEFAULT_PRIORITY) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function priorityOf(member, fallback = DEFAULT_PRIORITY) {
  const configured = member && member.priority != null
    ? member.priority
    : member && member.profile && member.profile.priority;
  return normalizePriority(configured, fallback);
}

function comparePoolPriority(a, b) {
  return priorityOf(a) - priorityOf(b);
}

/**
 * Normalize known routing fields while cloning every other field verbatim.
 * This intentionally does not use an allow-list: provider-specific and future
 * fields must survive a dashboard read/edit/save round trip.
 */
function normalizePoolEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new TypeError('Pool entries must be objects.');
  }

  const normalized = cloneConfigValue(entry);
  const provider = normalizeProvider(entry.provider != null ? entry.provider : entry.kind);
  if (provider) defineOwn(normalized, 'provider', provider);
  if (entry.model != null) defineOwn(normalized, 'model', normalizeModel(entry.model));
  if (hasOwn(entry, 'priority')) defineOwn(normalized, 'priority', normalizePriority(entry.priority));
  return normalized;
}

function normalizePoolEntries(entries) {
  if (!Array.isArray(entries)) throw new TypeError('Pool must be an array.');
  return entries.map(normalizePoolEntry);
}

// Saving is a clone/normalization operation rather than a projection. In
// particular, unknown fields are not discarded.
function serializePoolEntries(entries) {
  return normalizePoolEntries(entries);
}

/**
 * Restore opaque API placeholders from an earlier configuration value. The
 * caller must reject the result when unmatchedPaths is non-empty; persisting a
 * placeholder as a credential would silently corrupt the connection.
 */
function restoreMaskedValues(incoming, previous, options = {}) {
  const maskedValues = new Set(options.maskedValues || ['••••••••', '[REDACTED]']);
  const unmatchedPaths = [];
  const rootPath = options.path || '$';

  const visit = (value, prior, path) => {
    if (maskedValues.has(value)) {
      if (prior === undefined || maskedValues.has(prior)) {
        unmatchedPaths.push(path);
        return value;
      }
      return cloneConfigValue(prior);
    }
    if (Array.isArray(value)) {
      const priorArray = Array.isArray(prior) ? prior : [];
      return value.map((item, index) => visit(item, priorArray[index], `${path}[${index}]`));
    }
    if (value && typeof value === 'object') {
      const priorObject = prior && typeof prior === 'object' && !Array.isArray(prior) ? prior : {};
      const restored = Object.create(Object.getPrototypeOf(value) === null ? null : Object.prototype);
      for (const [key, nested] of Object.entries(value)) {
        const priorValue = hasOwn(priorObject, key) ? priorObject[key] : undefined;
        defineOwn(restored, key, visit(nested, priorValue, `${path}.${key}`));
      }
      return restored;
    }
    return value;
  };

  return { value: visit(incoming, previous, rootPath), unmatchedPaths };
}

function providerDefaultsFor(providers, provider) {
  if (!providers || typeof providers !== 'object' || !provider) return {};
  if (hasOwn(providers, provider) && providers[provider] && typeof providers[provider] === 'object') return providers[provider];
  const matchingKey = Object.keys(providers).find(key => normalizeProvider(key) === provider);
  return matchingKey && providers[matchingKey] && typeof providers[matchingKey] === 'object'
    ? providers[matchingKey]
    : {};
}

/** Resolve provider defaults for runtime use without mutating the saved entry. */
function resolvePoolMember(entry, providers = {}) {
  const normalized = normalizePoolEntry(entry);
  const provider = normalizeProvider(normalized.provider != null ? normalized.provider : normalized.kind);
  const defaults = cloneConfigValue(providerDefaultsFor(providers, provider));
  const resolved = { ...defaults, ...normalized };
  if (provider) {
    resolved.provider = provider;
    resolved.kind = provider;
  }
  resolved.model = normalizeModel(normalized.model != null ? normalized.model : defaults.model);
  return resolved;
}

function normalizeEndpoint(value) {
  if (value == null) return value;
  const text = String(value).trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    url.hash = '';
    url.searchParams.sort();
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString().replace(/\/$/, '');
  } catch {
    return text.replace(/\/+$/, '');
  }
}

function stableStringify(value, stack = new Set()) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  const type = typeof value;
  if (type === 'string' || type === 'boolean') return JSON.stringify(value);
  if (type === 'number') return Number.isFinite(value) ? String(value) : JSON.stringify(String(value));
  if (type === 'bigint') return `${value}n`;
  if (type !== 'object') return JSON.stringify(String(value));
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Buffer.isBuffer(value)) return JSON.stringify(`buffer:${value.toString('base64')}`);
  if (stack.has(value)) throw new TypeError('Pool identity fields must not contain cycles.');

  stack.add(value);
  let result;
  if (Array.isArray(value)) {
    result = `[${value.map(item => stableStringify(item, stack)).join(',')}]`;
  } else {
    result = `{${Object.keys(value).sort().map(key => (
      `${JSON.stringify(key)}:${stableStringify(value[key], stack)}`
    )).join(',')}}`;
  }
  stack.delete(value);
  return result;
}

function compactFieldName(name) {
  return String(name).replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function isCredentialField(name) {
  const compact = compactFieldName(name);
  if (CREDENTIAL_FIELD_NAMES.has(compact) || compact.includes('credential')) return true;
  return /(?:api|access|secret|private|session|refresh|auth|client|bearer|subscription)(?:keys?|keyid|tokens?|secrets?|passwords?)$/.test(compact);
}

function identityMaterialFor(member) {
  const connection = {};
  for (const field of CONNECTION_IDENTITY_FIELDS) {
    if (!hasOwn(member, field) || member[field] == null) continue;
    let value = member[field];
    if (field === 'provider' || field === 'kind') value = normalizeProvider(value);
    else if (field === 'model') value = normalizeModel(value);
    else if (field === 'endpoint' || field === 'baseUrl' || field === 'baseURL') value = normalizeEndpoint(value);
    connection[field] = value;
  }

  const credentials = {};
  for (const field of Object.keys(member).sort()) {
    if (isCredentialField(field) && member[field] != null) credentials[field] = member[field];
  }
  if (member.headers && typeof member.headers === 'object') {
    for (const header of Object.keys(member.headers).sort()) {
      if (/authorization|api[-_]?key|token|credential/i.test(header)) {
        credentials[`header:${header.toLowerCase()}`] = member.headers[header];
      }
    }
  }

  // Hash credentials separately before including them in the already-hashed
  // member identity. This makes accidental future diagnostics of connection
  // material safe by construction.
  const credentialDigest = crypto
    .createHash('sha256')
    .update(`${KEY_DOMAIN}/credentials\0${stableStringify(credentials)}`)
    .digest('hex');

  return { connection, credentialDigest };
}

/**
 * Stable, opaque identity used for both runtime statistics and UI lookups.
 * It is independent of array position and changes when the effective endpoint,
 * deployment, account, explicit member id, or credential identity changes.
 */
function poolMemberKey(entry, providers = {}) {
  const member = resolvePoolMember(entry, providers);
  const digest = crypto
    .createHash('sha256')
    .update(`${KEY_DOMAIN}\0${stableStringify(identityMaterialFor(member))}`)
    .digest('hex');
  return `pool:v1:${digest}`;
}

// Runtime and dashboard code should call this exact function; there is no
// provider/model-only compatibility key that can alias distinct connections.
const statsKeyForMember = poolMemberKey;

function normalizeCursor(cursor, poolLength) {
  const length = Math.max(0, Math.trunc(Number(poolLength) || 0));
  if (length === 0) return 0;
  const numeric = Number.isFinite(Number(cursor)) ? Math.trunc(Number(cursor)) : 0;
  return ((numeric % length) + length) % length;
}

function advanceRoundRobinCursor(cursor, selectedIndex, poolLength) {
  const length = Math.max(0, Math.trunc(Number(poolLength) || 0));
  if (length === 0) return 0;
  const selected = Number.isFinite(Number(selectedIndex))
    ? normalizeCursor(selectedIndex, length)
    : normalizeCursor(cursor, length);
  return (selected + 1) % length;
}

function statsForKey(statsByKey, key) {
  if (!statsByKey) return {};
  if (statsByKey instanceof Map) return statsByKey.get(key) || {};
  if (typeof statsByKey.get === 'function') return statsByKey.get(key) || {};
  return hasOwn(statsByKey, key) ? statsByKey[key] || {} : {};
}

function numericOr(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cooldownUntilFor(member, stats) {
  return Math.max(
    0,
    numericOr(stats && stats.cooledUntil, 0),
    numericOr(stats && stats.cooldownUntil, 0),
    numericOr(member && member.cooledUntil, 0),
    numericOr(member && member.cooldownUntil, 0),
  );
}

function capacityFor(member, stats, options = {}) {
  if (typeof options.capacityForMember === 'function') {
    const selected = Number(options.capacityForMember(member, stats));
    if (Number.isFinite(selected)) return Math.max(0, selected);
  }

  const configured = [
    member && member.maxConcurrency,
    member && member.capacity,
    stats && stats.capacity,
    options.perMemberCapacity,
  ].find(value => value != null && value !== '');
  if (configured == null) return Infinity;
  const numeric = Number(configured);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : Infinity;
}

function isPoolMemberEligible(member, stats = {}, options = {}) {
  if (!member || !member.provider || !member.model) return false;
  if (member.enabled === false || member.disabled === true || stats.disabled === true) return false;

  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  if (cooldownUntilFor(member, stats) > now) return false;
  if (numericOr(stats.cooldownSecsLeft, 0) > 0) return false;
  if (stats.saturated === true) return false;

  const inFlight = Math.max(0, numericOr(stats.inFlight, 0));
  return inFlight < capacityFor(member, stats, options);
}

function addIdentityValues(target, values, providers) {
  if (values == null) return target;
  const iterable = typeof values === 'string' || !values[Symbol.iterator]
    ? [values]
    : values;
  for (const value of iterable) {
    if (typeof value === 'string') target.add(value);
    else if (value && typeof value === 'object') target.add(poolMemberKey(value, providers));
  }
  return target;
}

function identitySet(values, providers) {
  return addIdentityValues(new Set(), values, providers);
}

/**
 * Select one eligible member. Only members in the best remaining (smallest)
 * priority tier participate in the round robin. attemptedKeys and excludedKeys
 * are opaque values returned as selection.key/statsKey.
 */
function selectPoolMember(pool, options = {}) {
  if (!Array.isArray(pool)) throw new TypeError('Pool must be an array.');
  if (pool.length === 0) return null;

  const providers = options.providers || {};
  const attempted = identitySet(options.attemptedKeys != null ? options.attemptedKeys : options.attempted, providers);
  const excluded = identitySet(options.excludedKeys != null ? options.excludedKeys : options.excluded, providers);
  const statsByKey = options.statsByKey || options.stats;
  const cursor = normalizeCursor(options.cursor, pool.length);
  const seen = new Set();
  const candidates = [];

  for (let index = 0; index < pool.length; index++) {
    const source = pool[index];
    const member = resolvePoolMember(source, providers);
    const key = poolMemberKey(source, providers);
    if (seen.has(key)) continue;
    seen.add(key);
    if (attempted.has(key) || excluded.has(key)) continue;

    const stats = statsForKey(statsByKey, key);
    if (!isPoolMemberEligible(member, stats, options)) continue;
    candidates.push({
      member,
      source,
      index,
      key,
      statsKey: key,
      stats,
      priority: priorityOf(member),
    });
  }

  if (candidates.length === 0) return null;
  const bestPriority = Math.min(...candidates.map(candidate => candidate.priority));
  const tier = candidates.filter(candidate => candidate.priority === bestPriority);
  tier.sort((a, b) => {
    const aDistance = (a.index - cursor + pool.length) % pool.length;
    const bDistance = (b.index - cursor + pool.length) % pool.length;
    return aDistance - bDistance || a.key.localeCompare(b.key);
  });

  const selected = tier[0];
  return {
    ...selected,
    cursor,
    nextCursor: advanceRoundRobinCursor(cursor, selected.index, pool.length),
  };
}

/**
 * Per-request selector. Calling next() immediately records the selected key,
 * so a failed attempt cannot select the same logical member again.
 */
function createPoolRequestSelector(pool, options = {}) {
  if (!Array.isArray(pool)) throw new TypeError('Pool must be an array.');
  const providers = options.providers || {};
  const attempted = identitySet(options.attemptedKeys != null ? options.attemptedKeys : options.attempted, providers);
  const excluded = identitySet(options.excludedKeys != null ? options.excludedKeys : options.excluded, providers);
  let cursor = normalizeCursor(options.cursor, pool.length);

  const api = {
    next(overrides = {}) {
      const callAttempted = new Set(attempted);
      addIdentityValues(callAttempted, overrides.attemptedKeys != null ? overrides.attemptedKeys : overrides.attempted, providers);
      const callExcluded = new Set(excluded);
      addIdentityValues(callExcluded, overrides.excludedKeys != null ? overrides.excludedKeys : overrides.excluded, providers);
      const selection = selectPoolMember(pool, {
        ...options,
        ...overrides,
        providers,
        cursor,
        attemptedKeys: callAttempted,
        excludedKeys: callExcluded,
      });
      if (!selection) return null;
      attempted.add(selection.key);
      cursor = selection.nextCursor;
      return selection;
    },

    exclude(memberOrKey) {
      addIdentityValues(excluded, memberOrKey, providers);
      return api;
    },

    hasAttempted(memberOrKey) {
      const keys = identitySet(memberOrKey, providers);
      for (const key of keys) if (attempted.has(key)) return true;
      return false;
    },

    getAttemptedKeys() {
      return new Set(attempted);
    },

    get cursor() {
      return normalizeCursor(cursor, pool.length);
    },
  };
  return api;
}

/** A credential-safe snapshot for UI/runtime stats joins. */
function buildPoolStatsSnapshot(pool, options = {}) {
  if (!Array.isArray(pool)) throw new TypeError('Pool must be an array.');
  const providers = options.providers || {};
  const statsByKey = options.statsByKey || options.stats;
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();

  return pool.map((entry, index) => {
    const member = resolvePoolMember(entry, providers);
    const key = statsKeyForMember(entry, providers);
    const stats = statsForKey(statsByKey, key);
    const capacity = capacityFor(member, stats, options);
    const inFlight = Math.max(0, numericOr(stats.inFlight, 0));
    const cooledUntil = cooldownUntilFor(member, stats);
    return {
      index,
      key,
      statsKey: key,
      provider: member.provider,
      model: member.model,
      label: member.label || `${member.provider} / ${member.model}`,
      priority: priorityOf(member),
      stats: {
        req: Math.max(0, numericOr(stats.req, 0)),
        err: Math.max(0, numericOr(stats.err, 0)),
        lastMs: Math.max(0, numericOr(stats.lastMs, 0)),
        consecutiveFails: Math.max(0, numericOr(stats.consecutiveFails, 0)),
        inFlight,
        queued: Math.max(0, numericOr(stats.queued, 0)),
        capacity: Number.isFinite(capacity) ? capacity : null,
        available: Number.isFinite(capacity) ? Math.max(0, capacity - inFlight) : null,
        cooledUntil,
        cooldownSecsLeft: cooledUntil > now ? Math.ceil((cooledUntil - now) / 1000) : 0,
      },
    };
  });
}

module.exports = {
  DEFAULT_PRIORITY,
  normalizePriority,
  priorityOf,
  comparePoolPriority,
  normalizePoolEntry,
  normalizePoolEntries,
  serializePoolEntries,
  restoreMaskedValues,
  resolvePoolMember,
  poolMemberKey,
  statsKeyForMember,
  normalizeCursor,
  advanceRoundRobinCursor,
  isPoolMemberEligible,
  selectPoolMember,
  createPoolRequestSelector,
  buildPoolStatsSnapshot,
};
