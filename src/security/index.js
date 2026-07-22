'use strict';

/**
 * Security primitives shared by the Proxy-Max HTTP surface.
 *
 * This module deliberately has no dependency on the running server.  Callers can
 * adopt the helpers route-by-route, and tests can exercise them without binding a
 * socket or loading configuration/provider code.
 */

const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');

const REDACTED = '[REDACTED]';

const JSON_BODY_ERROR = Object.freeze({
  BAD_REQUEST: Object.freeze({
    status: 400,
    code: 'INVALID_JSON_BODY',
    message: 'Invalid JSON request body',
  }),
  TOO_LARGE: Object.freeze({
    status: 413,
    code: 'JSON_BODY_TOO_LARGE',
    message: 'JSON request body exceeds the configured byte limit',
  }),
});

class JsonBodyError extends Error {
  constructor(definition) {
    super(definition.message);
    this.name = 'JsonBodyError';
    this.status = definition.status;
    this.statusCode = definition.status;
    this.code = definition.code;
    this.expose = true;
  }
}

const DEFAULT_STATIC_EXTENSIONS = new Set([
  '.avif', '.css', '.gif', '.html', '.ico', '.jpeg', '.jpg', '.js', '.json',
  '.mjs', '.otf', '.png', '.svg', '.ttf', '.txt', '.wasm', '.webmanifest',
  '.webp', '.woff', '.woff2', '.xml',
]);

const FORBIDDEN_STATIC_SEGMENTS = new Set([
  '.git', '.github', '.hg', '.svn',
  'config', 'configs', 'configuration',
  'log', 'logs',
  'node_modules',
  'source', 'sources', 'src',
]);

const FORBIDDEN_STATIC_FILES = new Set([
  'bun.lock', 'bun.lockb',
  'config.json', 'config.local.json', 'credentials.json',
  'package.json', 'package-lock.json',
  'pnpm-lock.yaml', 'secrets.json', 'yarn.lock',
]);

const SECRET_NAME_EXACT = new Set([
  'apikey', 'apikeys', 'apitoken', 'authorization', 'authsecret', 'authtoken', 'bearertoken',
  'certificate', 'clientcertificate', 'clientsecret', 'connectionstring',
  'cookie', 'credentials', 'dashboardtoken', 'idtoken',
  'ocpapimsubscriptionkey', 'serviceaccountjson', 'subscriptionkey',
  'password', 'passwd', 'passphrase', 'privatekey', 'proxyauthorization',
  'proxytoken', 'refreshtoken', 'sastoken', 'secret', 'secrets', 'secretkey', 'sessioncookie',
  'sessionsecret', 'sessiontoken', 'setcookie', 'token', 'xapikey',
  'webhooksecret', 'xauthtoken', 'xdashboardtoken', 'xfunctionskey',
  'xgoogapikey', 'xproxymaxtoken',
  'awsaccesskeyid', 'awssecretaccesskey', 'awssessiontoken',
]);

const QUERY_SECRET_NAMES = new Set([
  ...SECRET_NAME_EXACT,
  'accesskey', 'accesstoken', 'auth', 'code', 'credential', 'key', 'pass',
  'pwd', 'sig', 'signature', 'xamzcredential', 'xamzsecuritytoken',
  'xamzsignature',
]);

const USAGE_TOKEN_NAMES = new Set([
  'acceptedpredictiontokens', 'audiotokens', 'billabletokens',
  'cachecreationinputtokens', 'cachecreationtokens', 'cachedinputtokens',
  'cachedtokens', 'cachereadinputtokens', 'cachereadtokens',
  'cachewriteinputtokens', 'cachewritetokens', 'completiontokens',
  'contexttokens', 'generatedtokens', 'inputtokens', 'maxtokens', 'mintokens',
  'outputtokens', 'prompttokens', 'reasoningtokens',
  'rejectedpredictiontokens', 'thinkingtokens', 'tokencount', 'tokencounts',
  'tokens', 'tokenssaved', 'tokenusage', 'totaltokens',
]);

const SECRET_LABEL_SOURCE = [
  'authorization',
  'proxy[-_ ]?authorization',
  'x[-_ ]?api[-_ ]?key',
  'x[-_ ]?goog[-_ ]?api[-_ ]?key',
  'x[-_ ]?functions[-_ ]?key',
  '(?:ocp[-_ ]?apim[-_ ]?)?subscription[-_ ]?key',
  'api[-_ ]?key',
  'apikey',
  '(?:api|access|refresh|identity|id|auth|bearer|session|dashboard|proxy|oauth|github|slack|jwt|sas|admin|inference)[-_ ]?tokens?',
  'token',
  'client[-_ ]?secret',
  'webhook[-_ ]?secret',
  'secret(?:[-_ ]?(?:access[-_ ]?)?key)?',
  'connection[-_ ]?string',
  'service[-_ ]?account[-_ ]?json',
  'client[-_ ]?certificate',
  'certificate',
  'password',
  'passwd',
  'passphrase',
  'private[-_ ]?key',
  'credentials?',
  'aws[-_ ]?access[-_ ]?key[-_ ]?id',
  'aws[-_ ]?secret[-_ ]?access[-_ ]?key',
  'aws[-_ ]?session[-_ ]?token',
  'cookie',
  'set[-_ ]?cookie',
].join('|');

const QUERY_SECRET_SOURCE = [
  'api[-_]?key', 'apikey', 'key', 'token',
  'x[-_]?goog[-_]?api[-_]?key', 'x[-_]?functions[-_]?key',
  '(?:ocp[-_]?apim[-_]?)?subscription[-_]?key',
  '(?:api|access|refresh|session|auth|dashboard|proxy|oauth|github|slack|jwt|sas|admin|inference)[-_]?tokens?',
  'authorization', 'auth', 'client[-_]?secret', 'webhook[-_]?secret',
  'connection[-_]?string', 'service[-_]?account[-_]?json',
  'client[-_]?certificate', 'certificate', 'secret', 'password', 'pass',
  'passwd', 'pwd', 'code', 'credential', 'signature', 'sig',
  'x[-_]?amz[-_]?(?:credential|security[-_]?token|signature)',
].join('|');

function normalizeName(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isUsageTokenName(name) {
  const normalized = normalizeName(name);
  if (USAGE_TOKEN_NAMES.has(normalized)) return true;

  // Usage counters are conventionally plural or explicitly suffixed with
  // "count".  Credential tokens use singular names such as access_token.
  if (/^(?:input|output|prompt|completion|total|cached|reasoning|thinking|generated|audio|context)tokens$/.test(normalized)) {
    return true;
  }
  return /^(?:token|tokens)(?:count|counts|used|saved|usage)$/.test(normalized);
}

function isSensitiveName(name) {
  const normalized = normalizeName(name);
  if (!normalized || isUsageTokenName(normalized)) return false;
  if (SECRET_NAME_EXACT.has(normalized)) return true;

  if (/(?:passwords?|passwd|passphrases?|privatekeys?|secretkeys?|clientsecrets?|webhooksecrets?)$/.test(normalized)) return true;
  if (/(?:subscriptionkey|functionskey|googapikey|connectionstring|serviceaccountjson|clientcertificate|certificate)$/.test(normalized)) return true;
  if (/^(?:aws)?(?:accesskeyid|secretaccesskey|sessiontoken)$/.test(normalized)) return true;
  if (/(?:authorization|credentials?|sessioncookie|setcookie)$/.test(normalized)) return true;
  if (/token$/.test(normalized)) return true;
  if (/(?:api|access|refresh|identity|auth|bearer|session|dashboard|proxy|oauth|github|slack|jwt|sas|admin|inference|csrf|xsrf)tokens$/.test(normalized)) return true;
  return /(?:^|x)apikeys?$/.test(normalized);
}

function isSecretQueryName(name) {
  const normalized = normalizeName(name);
  return QUERY_SECRET_NAMES.has(normalized) || isSensitiveName(normalized);
}

function pathIsInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

function safeRealpath(target) {
  try {
    return fs.realpathSync.native ? fs.realpathSync.native(target) : fs.realpathSync(target);
  } catch {
    return null;
  }
}

function extractRawPath(requestTarget) {
  if (typeof requestTarget !== 'string' || requestTarget.length === 0 || requestTarget.length > 8192) return null;
  if (/[^\x20-\x7e]/.test(requestTarget) || requestTarget.includes('\\')) return null;

  // HTTP origin-form only.  Reject absolute-form and network-path references so
  // URL parsers cannot silently normalize away evidence of traversal.
  if (!requestTarget.startsWith('/') || requestTarget.startsWith('//')) return null;
  const end = requestTarget.search(/[?#]/);
  const rawPath = end === -1 ? requestTarget : requestTarget.slice(0, end);

  // Encoded separators and NULs are rejected before decoding.  A second encoded
  // layer is rejected below rather than decoded repeatedly.
  if (/%(?:00|2f|5c)/i.test(rawPath)) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (/%[0-9a-f]{2}/i.test(decoded) || decoded.includes('\\') || decoded.includes('\0')) return null;
  return decoded;
}

function staticPathLooksSafe(decodedPath) {
  const segments = decodedPath.split('/').slice(1);
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || segment.startsWith('.'))) return false;

  for (const segment of segments) {
    const lower = segment.toLowerCase();
    if (FORBIDDEN_STATIC_SEGMENTS.has(lower)) return false;
    if (FORBIDDEN_STATIC_FILES.has(lower)) return false;
    if (/^\.env(?:\.|$)/i.test(segment)) return false;
    if (/\.(?:db|key|log|map|pem|pfx|p12|sqlite|sqlite3)(?:\.\d+)?$/i.test(segment)) return false;
  }
  return true;
}

/**
 * Resolve an HTTP request target to an existing regular UI/public asset.
 *
 * Only /ui, /assets, and /public mounts are recognized.  `null` means the
 * request must not be served.  Both lexical containment and real filesystem
 * containment are checked, which prevents prefix collisions and symlink exits.
 */
function resolveStaticPath(requestTarget, options = {}) {
  const projectRoot = path.resolve(options.projectRoot || path.join(__dirname, '..', '..'));
  const decoded = extractRawPath(requestTarget);
  if (decoded === null) return null;

  let routedPath = decoded;
  if (routedPath === '/' || routedPath === '/ui' || routedPath === '/ui/') {
    routedPath = `/ui/${options.indexFile || 'index.html'}`;
  }
  if (!staticPathLooksSafe(routedPath)) return null;

  const mounts = [
    { prefix: '/ui', root: path.resolve(options.uiRoot || path.join(projectRoot, 'ui')) },
    { prefix: '/assets', root: path.resolve(options.assetsRoot || path.join(projectRoot, 'assets')) },
    { prefix: '/public', root: path.resolve(options.publicRoot || path.join(projectRoot, 'public')) },
  ];
  const mount = mounts.find(entry => routedPath === entry.prefix || routedPath.startsWith(`${entry.prefix}/`));
  if (!mount || routedPath === mount.prefix) return null;

  const relativeUrlPath = routedPath.slice(mount.prefix.length + 1);
  const candidate = path.resolve(mount.root, ...relativeUrlPath.split('/'));
  if (!pathIsInside(mount.root, candidate)) return null;

  const extension = path.extname(candidate).toLowerCase();
  const allowedExtensions = options.allowedExtensions
    ? new Set(Array.from(options.allowedExtensions, ext => String(ext).toLowerCase()))
    : DEFAULT_STATIC_EXTENSIONS;
  if (!extension || !allowedExtensions.has(extension)) return null;

  const realRoot = safeRealpath(mount.root);
  const realCandidate = safeRealpath(candidate);
  if (!realRoot || !realCandidate || !pathIsInside(realRoot, realCandidate)) return null;

  try {
    if (!fs.statSync(realCandidate).isFile()) return null;
  } catch {
    return null;
  }
  return realCandidate;
}

function sanitizeParameterString(raw) {
  if (!raw) return raw;
  const pairs = String(raw).split('&');
  return pairs.map(pair => {
    const separator = pair.indexOf('=');
    const rawKey = separator === -1 ? pair : pair.slice(0, separator);
    const rawValue = separator === -1 ? '' : pair.slice(separator + 1);
    let decodedKey = rawKey;
    let decodedValue = rawValue;
    try { decodedKey = decodeURIComponent(rawKey.replace(/\+/g, ' ')); } catch {}
    try { decodedValue = decodeURIComponent(rawValue.replace(/\+/g, ' ')); } catch {}

    if (isSecretQueryName(decodedKey)) return `${encodeURIComponent(decodedKey)}=${REDACTED}`;
    const safeValue = redactStringInternal(decodedValue, { skipUrls: false });
    return separator === -1
      ? encodeURIComponent(decodedKey)
      : `${encodeURIComponent(decodedKey)}=${encodeURIComponent(safeValue)}`;
  }).join('&');
}

function sanitizeOneUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value));
  } catch {
    return null;
  }

  const scheme = parsed.protocol;
  const slashes = String(value).slice(scheme.length).startsWith('//') ? '//' : '';
  if (!slashes) return null;

  const hadUserInfo = parsed.username !== '' || parsed.password !== '';
  const authority = `${hadUserInfo ? `${REDACTED}@` : ''}${parsed.host}`;
  const query = parsed.search.length > 1 ? `?${sanitizeParameterString(parsed.search.slice(1))}` : '';
  const fragment = parsed.hash.length > 1 ? `#${sanitizeParameterString(parsed.hash.slice(1))}` : parsed.hash;
  return `${scheme}//${authority}${parsed.pathname}${query}${fragment}`;
}

function redactKnownCredentialShapes(value) {
  let output = value;

  // Private key material is unsafe even when it is not accompanied by a field
  // name (for example, a pasted PEM block in an exception message).
  output = output.replace(
    /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g,
    REDACTED,
  );

  // Header forms consume the entire header value.  This runs before generic
  // assignment matching so "Authorization: Bearer secret" cannot leave the
  // bearer payload behind.
  output = output.replace(
    /(^|[\r\n])(\s*(?:authorization|proxy-authorization|cookie|set-cookie|x[-_ ]?goog[-_ ]?api[-_ ]?key|x[-_ ]?functions[-_ ]?key|(?:ocp[-_ ]?apim[-_ ]?)?subscription[-_ ]?key)\s*:\s*)[^\r\n]*/gi,
    (_match, lineStart, prefix) => `${lineStart}${prefix}${REDACTED}`,
  );

  output = output.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, (_match, scheme) => `${scheme} ${REDACTED}`);

  // JSON and common configuration syntax.  Either the key, the value, or both
  // may be quoted. Escaped characters are consumed with the value so a suffix
  // cannot survive a partial match.
  const secretKeyPattern = `(?:"(?:${SECRET_LABEL_SOURCE})"|'(?:${SECRET_LABEL_SOURCE})'|\\b(?:${SECRET_LABEL_SOURCE})\\b)`;
  const doubleQuoted = new RegExp(`(${secretKeyPattern}\\s*[:=]\\s*")((?:\\\\.|[^"\\\\])*)(")`, 'gi');
  output = output.replace(doubleQuoted, `$1${REDACTED}$3`);
  const singleQuoted = new RegExp(`(${secretKeyPattern}\\s*[:=]\\s*')((?:\\\\.|[^'\\\\])*)(')`, 'gi');
  output = output.replace(singleQuoted, `$1${REDACTED}$3`);

  const bareAssignment = new RegExp(`(${secretKeyPattern}\\s*[:=]\\s*)(?!["'])(${String.raw`\[REDACTED\]`}|[^\\s,;&}\\]]+)`, 'gi');
  output = output.replace(bareAssignment, `$1${REDACTED}`);

  const cliAssignment = new RegExp(`(--(?:${SECRET_LABEL_SOURCE})(?:=|\\s+))(["']?)([^\\s"']+)\\2`, 'gi');
  output = output.replace(cliAssignment, (_match, prefix, quote) => `${prefix}${quote}${REDACTED}${quote}`);

  const queryAssignment = new RegExp(`([?&](?:${QUERY_SECRET_SOURCE})=)([^&#\\s]*)`, 'gi');
  output = output.replace(queryAssignment, `$1${REDACTED}`);
  output = output.replace(/([?&#])([^=&#\s]{1,128})=([^&#\s]*)/g, (match, prefix, rawKey) => {
    let decodedKey = rawKey;
    try { decodedKey = decodeURIComponent(rawKey.replace(/\+/g, ' ')); } catch {}
    return isSecretQueryName(decodedKey) ? `${prefix}${rawKey}=${REDACTED}` : match;
  });

  // Widely recognizable credentials should be removed even when a library logs
  // only the value.  The minimum lengths reduce false positives for prose.
  output = output.replace(/\b(?:AKIA|ASIA|AIDA|AROA|AIPA|ANPA|ANVA|ASCA)[A-Z0-9]{16}\b/g, REDACTED);
  output = output.replace(/\bsk-(?:proj-|svcacct-|ant-[A-Za-z0-9_-]*-)?[A-Za-z0-9_-]{16,}\b/g, REDACTED);
  output = output.replace(/\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b/g, REDACTED);
  output = output.replace(/\bAIza[0-9A-Za-z_-]{35}\b/g, REDACTED);
  output = output.replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, REDACTED);
  output = output.replace(/\bsk_live_[A-Za-z0-9]{16,}\b/g, REDACTED);
  output = output.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, REDACTED);
  return output;
}

function redactStringInternal(value, options = {}) {
  let output = String(value);
  if (!options.skipUrls) {
    output = output.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`]+/gi, match => {
      let candidate = match;
      let trailing = '';
      while (/[),.;!?]$/.test(candidate)) {
        trailing = candidate.slice(-1) + trailing;
        candidate = candidate.slice(0, -1);
      }
      const sanitized = sanitizeOneUrl(candidate);
      return `${sanitized === null ? candidate : sanitized}${trailing}`;
    });
  }
  return redactKnownCredentialShapes(output);
}

function redactString(value) {
  if (value === null || value === undefined) return value;
  return redactStringInternal(value);
}

function redactUrl(value) {
  if (value === null || value === undefined) return value;
  const source = value instanceof URL ? value.href : String(value);
  return sanitizeOneUrl(source) || redactStringInternal(source, { skipUrls: true });
}

/**
 * Create a deeply redacted, JSON-friendly copy.  Getters are not invoked and
 * cycles become a marker, making the result safe to hand to a logger.
 */
function redactSecrets(value, state = null) {
  const active = state || new WeakSet();
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'bigint') return String(value);
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof URL) return redactUrl(value);
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return String(value);
  if (active.has(value)) return '[Circular]';

  active.add(value);
  try {
    if (Array.isArray(value)) return value.map(item => redactSecrets(item, active));

    const output = {};
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) continue;
      const safeValue = !Object.prototype.hasOwnProperty.call(descriptor, 'value')
        ? REDACTED
        : (isSensitiveName(key) ? REDACTED : redactSecrets(descriptor.value, active));
      Object.defineProperty(output, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: safeValue,
      });
    }
    return output;
  } finally {
    active.delete(value);
  }
}

function getSingleHeader(requestOrHeaders, name) {
  const headers = requestOrHeaders && requestOrHeaders.headers
    ? requestOrHeaders.headers
    : (requestOrHeaders || {});
  let value;
  if (typeof headers.get === 'function') {
    value = headers.get(name);
  } else {
    value = headers[String(name).toLowerCase()];
    if (value === undefined) {
      const actual = Object.keys(headers).find(key => key.toLowerCase() === String(name).toLowerCase());
      if (actual) value = headers[actual];
    }
  }
  if (Array.isArray(value)) return value.length === 1 ? String(value[0]) : null;
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const stringValue = String(value);
  if (/[\r\n\0]/.test(stringValue)) return null;
  return stringValue;
}

function drainRequest(req) {
  // `resume()` consumes and discards future chunks without retaining them.  It
  // lets a keep-alive connection finish cleanly after an early Content-Length
  // rejection, while still honoring the rule that oversized bytes are never
  // accumulated by this reader.
  try {
    if (req && typeof req.resume === 'function' && !req.destroyed) req.resume();
  } catch {}
}

function badJsonBody() {
  return new JsonBodyError(JSON_BODY_ERROR.BAD_REQUEST);
}

function oversizedJsonBody() {
  return new JsonBodyError(JSON_BODY_ERROR.TOO_LARGE);
}

function parseContentLength(req, maxBytes) {
  const raw = getSingleHeader(req, 'content-length');
  if (raw === undefined) return { declared: null };
  if (raw === null || !/^\d+$/.test(raw.trim())) return { error: badJsonBody() };
  try {
    const declaredBigInt = BigInt(raw.trim());
    if (declaredBigInt > BigInt(maxBytes)) return { error: oversizedJsonBody() };
    if (declaredBigInt > BigInt(Number.MAX_SAFE_INTEGER)) return { error: oversizedJsonBody() };
    return { declared: Number(declaredBigInt) };
  } catch {
    return { error: badJsonBody() };
  }
}

/**
 * Read and parse a JSON request with a hard byte ceiling.
 *
 * The Content-Length header is checked before listeners are installed.  For
 * chunked/misreported bodies, byte length is counted before each chunk is added,
 * and retained chunks are released as soon as the limit is crossed.  All client
 * body failures use a stable 400 error; all size failures use a stable 413.
 */
function readJsonBody(req, options = {}) {
  const maxBytes = options.maxBytes ?? options.limitBytes ?? (1024 * 1024);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError('maxBytes must be a positive safe integer');
  }
  if (!req || typeof req.on !== 'function' || req.destroyed || req.readableAborted) {
    return Promise.reject(badJsonBody());
  }

  const transferEncoding = getSingleHeader(req, 'transfer-encoding');
  const contentLength = parseContentLength(req, maxBytes);
  if (contentLength.error) {
    drainRequest(req);
    return Promise.reject(contentLength.error);
  }
  if (transferEncoding === null
      || (transferEncoding !== undefined && transferEncoding.trim().toLowerCase() !== 'chunked')
      || (transferEncoding !== undefined && contentLength.declared !== null)) {
    drainRequest(req);
    return Promise.reject(badJsonBody());
  }

  return new Promise((resolve, reject) => {
    let chunks = [];
    let received = 0;
    let settled = false;

    const cleanup = () => {
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('aborted', onAborted);
      req.removeListener('error', onError);
      req.removeListener('close', onClose);
    };

    const fail = (error, shouldDrain = false) => {
      if (settled) return;
      settled = true;
      chunks = [];
      cleanup();
      if (shouldDrain) drainRequest(req);
      reject(error);
    };

    const onData = chunk => {
      if (settled) return;
      let chunkBytes;
      if (Buffer.isBuffer(chunk)) {
        chunkBytes = chunk.length;
      } else if (typeof chunk === 'string') {
        chunkBytes = Buffer.byteLength(chunk);
      } else if (ArrayBuffer.isView(chunk)) {
        chunkBytes = chunk.byteLength;
      } else {
        fail(badJsonBody(), true);
        return;
      }

      received += chunkBytes;
      if (!Number.isSafeInteger(received) || received > maxBytes) {
        fail(oversizedJsonBody(), true);
        return;
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    };

    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      if (contentLength.declared !== null && received !== contentLength.declared) {
        chunks = [];
        reject(badJsonBody());
        return;
      }

      const body = Buffer.concat(chunks, received);
      chunks = [];
      let source;
      try {
        source = new TextDecoder('utf-8', { fatal: true }).decode(body);
      } catch {
        reject(badJsonBody());
        return;
      }
      if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);
      if (source.trim() === '') {
        if (options.allowEmpty === false) reject(badJsonBody());
        else resolve(options.emptyValue === undefined ? {} : options.emptyValue);
        return;
      }
      try {
        resolve(JSON.parse(source));
      } catch {
        reject(badJsonBody());
      }
    };

    const onAborted = () => fail(badJsonBody());
    const onError = () => fail(badJsonBody());
    const onClose = () => fail(badJsonBody());

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('aborted', onAborted);
    req.on('error', onError);
    req.on('close', onClose);
  });
}

function normalizeHostname(hostname) {
  let normalized = String(hostname || '').trim().toLowerCase();
  if (normalized.startsWith('[') && normalized.endsWith(']')) normalized = normalized.slice(1, -1);
  if (normalized.endsWith('.')) normalized = normalized.slice(0, -1);
  return normalized;
}

function parseHostHeader(rawHost) {
  if (typeof rawHost !== 'string' || !rawHost || rawHost.length > 255) return null;
  if (/[\s/@,#\\]/.test(rawHost) || rawHost.includes('://')) return null;
  try {
    const parsed = new URL(`http://${rawHost}`);
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
    return {
      hostname: normalizeHostname(parsed.hostname),
      port: parsed.port,
      host: parsed.host.toLowerCase(),
    };
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname) {
  const normalized = normalizeHostname(hostname);
  return normalized === 'localhost' || isLoopbackAddress(normalized);
}

function parseIpv6Words(address) {
  let source = String(address).toLowerCase();
  if (net.isIP(source) !== 6 || source.includes('%')) return null;

  const dottedTail = /(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(source);
  if (dottedTail) {
    const octets = dottedTail[1].split('.').map(Number);
    if (octets.some(octet => octet < 0 || octet > 255)) return null;
    const firstWord = ((octets[0] << 8) | octets[1]).toString(16);
    const secondWord = ((octets[2] << 8) | octets[3]).toString(16);
    source = `${source.slice(0, dottedTail.index + (source[dottedTail.index] === ':' ? 1 : 0))}${firstWord}:${secondWord}`;
  }

  const halves = source.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const words = [...left, ...Array(missing).fill('0'), ...right];
  if (words.length !== 8 || words.some(word => !/^[0-9a-f]{1,4}$/.test(word))) return null;
  return words.map(word => parseInt(word, 16));
}

/** Return true only for an unambiguous IPv4/IPv6 loopback socket address. */
function isLoopbackAddress(address) {
  if (typeof address !== 'string' || !address || address.length > 128 || address !== address.trim()) return false;
  const family = net.isIP(address);
  if (family === 4) return Number(address.split('.')[0]) === 127;
  if (family !== 6) return false;

  const words = parseIpv6Words(address);
  if (!words) return false;
  const ipv6Loopback = words.slice(0, 7).every(word => word === 0) && words[7] === 1;
  const mappedIpv4Loopback = words.slice(0, 5).every(word => word === 0)
    && words[5] === 0xffff
    && (words[6] >> 8) === 127;
  return ipv6Loopback || mappedIpv4Loopback;
}

function isLoopbackSocketAddress(socketOrRequest) {
  if (typeof socketOrRequest === 'string') return isLoopbackAddress(socketOrRequest);
  const socket = socketOrRequest && (socketOrRequest.socket || socketOrRequest.connection || socketOrRequest);
  return Boolean(socket && isLoopbackAddress(socket.remoteAddress));
}

function requestProtocol(req, options) {
  if (options.protocol === 'http' || options.protocol === 'https') return options.protocol;
  if (req && req.socket && req.socket.encrypted) return 'https';
  return 'http';
}

function effectivePort(protocol, port) {
  if (port) return String(port);
  return protocol === 'https' ? '443' : '80';
}

function requestAuthority(req, options = {}) {
  const rawHost = getSingleHeader(req, 'host') ?? getSingleHeader(req, ':authority');
  if (rawHost === null || rawHost === undefined) return null;
  const parsed = parseHostHeader(rawHost);
  if (!parsed) return null;
  const protocol = requestProtocol(req, options);
  return { ...parsed, protocol, effectivePort: effectivePort(protocol, parsed.port) };
}

function parseOrigin(rawOrigin) {
  if (typeof rawOrigin !== 'string' || !rawOrigin || rawOrigin === 'null' || rawOrigin.length > 2048) return null;
  if (/[\r\n\0]/.test(rawOrigin)) return null;
  try {
    const parsed = new URL(rawOrigin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    if (parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.origin === 'null') return null;
    const protocol = parsed.protocol.slice(0, -1);
    return {
      origin: parsed.origin,
      protocol,
      hostname: normalizeHostname(parsed.hostname),
      port: parsed.port,
      effectivePort: effectivePort(protocol, parsed.port),
    };
  } catch {
    return null;
  }
}

function sameRequestOrigin(origin, authority) {
  return Boolean(origin && authority
    && origin.protocol === authority.protocol
    && origin.hostname === authority.hostname
    && origin.effectivePort === authority.effectivePort);
}

function configuredHostMatches(authority, configured) {
  if (!authority || typeof configured !== 'string') return false;
  const parsed = parseHostHeader(configured);
  if (!parsed || parsed.hostname !== authority.hostname) return false;
  return parsed.port === '' || parsed.port === authority.port;
}

function configuredOriginMatches(origin, configured) {
  const parsed = parseOrigin(configured);
  return Boolean(parsed && origin
    && parsed.protocol === origin.protocol
    && parsed.hostname === origin.hostname
    && parsed.effectivePort === origin.effectivePort);
}

function timingSafeTokenEqual(actual, expected) {
  if ((typeof actual !== 'string' && !Buffer.isBuffer(actual))
      || (typeof expected !== 'string' && !Buffer.isBuffer(expected))) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length === 0 || expectedBuffer.length === 0 || actualBuffer.length > 8192 || expectedBuffer.length > 8192) return false;
  const actualDigest = crypto.createHash('sha256').update(actualBuffer).digest();
  const expectedDigest = crypto.createHash('sha256').update(expectedBuffer).digest();
  const digestMatches = crypto.timingSafeEqual(actualDigest, expectedDigest);
  return digestMatches && actualBuffer.length === expectedBuffer.length;
}

function requestTokenDetails(req, options = {}) {
  const headerNames = options.tokenHeaders || [
    options.tokenHeader || 'x-proxy-max-admin-token',
    'x-proxy-max-token',
    'x-dashboard-token',
  ];
  const candidates = [];
  for (const headerName of new Set(headerNames.map(name => String(name).toLowerCase()))) {
    const raw = getSingleHeader(req, headerName);
    if (raw === null) return { token: null, ambiguous: true };
    if (raw !== undefined && raw.trim()) candidates.push(raw.trim());
  }

  if (options.allowBearer !== false) {
    const authorization = getSingleHeader(req, 'authorization');
    if (authorization === null) return { token: null, ambiguous: true };
    if (authorization !== undefined) {
      const match = /^Bearer[ \t]+([^ \t]+)$/i.exec(authorization.trim());
      if (match) candidates.push(match[1]);
      else if (authorization.trim()) return { token: null, ambiguous: true };
    }
  }

  const unique = [...new Set(candidates)];
  if (unique.length !== 1 || unique[0].length > 8192) {
    return { token: null, ambiguous: unique.length > 1 };
  }
  return { token: unique[0], ambiguous: false };
}

function extractRequestToken(req, options = {}) {
  return requestTokenDetails(req, options).token;
}

function denial(status, reason) {
  return { ok: false, status, reason };
}

/**
 * Validate a dashboard/management API request.
 *
 * A configured token is required by default.  Without a valid token, both the
 * Host and the actual peer socket must be loopback (unless the caller explicitly
 * opts into allowTokenlessRemote). This helper is for management routes, not
 * model inference routes.
 */
function validateBrowserRequest(req, options = {}) {
  const authority = requestAuthority(req, options);
  if (!authority) return denial(400, 'invalid-host');

  const allowedHosts = Array.isArray(options.allowedHosts) ? options.allowedHosts : [];
  const trustedHost = options.allowAnyHost === true
    || isLoopbackHostname(authority.hostname)
    || allowedHosts.some(host => configuredHostMatches(authority, host));
  if (!trustedHost) return denial(403, 'untrusted-host');

  const fetchSiteHeader = getSingleHeader(req, 'sec-fetch-site');
  if (fetchSiteHeader === null) return denial(400, 'invalid-fetch-metadata');
  const fetchSite = fetchSiteHeader && fetchSiteHeader.trim().toLowerCase();
  if (fetchSite && !['same-origin', 'same-site', 'cross-site', 'none'].includes(fetchSite)) {
    return denial(403, 'invalid-fetch-metadata');
  }

  const expectedToken = options.token ?? options.dashboardToken ?? options.apiToken;
  const tokenConfigured = (typeof expectedToken === 'string' || Buffer.isBuffer(expectedToken))
    && Buffer.byteLength(expectedToken) > 0;
  const requireToken = options.requireToken === undefined ? tokenConfigured : options.requireToken === true;
  if (requireToken && !tokenConfigured) return denial(503, 'token-not-configured');

  const tokenDetails = requestTokenDetails(req, options);
  const validToken = tokenConfigured && tokenDetails.token !== null
    && timingSafeTokenEqual(tokenDetails.token, expectedToken);
  if (requireToken && !validToken) return denial(401, 'unauthorized');

  // Host is attacker-controlled.  Without a valid management token, accepting
  // Host: localhost from a non-loopback peer would expose admin routes through a
  // reverse proxy or a direct spoofed request.  Both views must say loopback.
  const tokenlessLocal = isLoopbackHostname(authority.hostname) && isLoopbackSocketAddress(req);
  if (!validToken && !tokenlessLocal && options.allowTokenlessRemote !== true) {
    return denial(403, 'non-local-client');
  }

  const originHeader = getSingleHeader(req, 'origin');
  if (originHeader === null) return denial(400, 'invalid-origin');
  if (originHeader !== undefined) {
    const origin = parseOrigin(originHeader);
    if (!origin) return denial(403, 'untrusted-origin');
    const allowedOrigins = Array.isArray(options.allowedOrigins) ? options.allowedOrigins : [];
    const explicitlyAllowed = allowedOrigins.some(item => configuredOriginMatches(origin, item));
    if (!sameRequestOrigin(origin, authority) && !explicitlyAllowed) return denial(403, 'untrusted-origin');
    if (fetchSite && fetchSite !== 'same-origin' && !explicitlyAllowed) return denial(403, 'cross-site-request');
  } else if (fetchSite === 'same-site' || fetchSite === 'cross-site') {
    return denial(403, 'cross-site-request');
  } else if (fetchSite === 'none') {
    const method = String(req && req.method || 'GET').toUpperCase();
    const safeNavigation = ['GET', 'HEAD'].includes(method) && options.allowTopLevelNavigation !== false;
    if (!safeNavigation && !validToken) return denial(403, 'missing-origin');
  } else if (fetchSite !== 'same-origin' && !validToken && options.allowMissingOrigin === false) {
    return denial(403, 'missing-origin');
  }

  return {
    ok: true,
    status: 200,
    reason: 'authorized',
    authenticated: Boolean(validToken),
    local: tokenlessLocal,
    origin: originHeader,
  };
}

function normalizeMethods(methods) {
  const source = methods || ['GET', 'POST', 'OPTIONS'];
  return [...new Set(source.map(method => String(method).trim().toUpperCase()).filter(method => /^[A-Z]+$/.test(method)))];
}

function normalizeHeaderNames(names) {
  const source = names || [
    'content-type', 'authorization', 'x-api-key', 'x-proxy-max-token',
    'x-proxy-max-admin-token', 'x-dashboard-token', 'anthropic-version', 'anthropic-beta',
    'request-id', 'x-request-id',
  ];
  return [...new Set(source.map(name => String(name).trim().toLowerCase()).filter(name => /^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name)))];
}

function corsVary(preflight) {
  return preflight
    ? 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers'
    : 'Origin';
}

/**
 * Decide whether CORS headers may be emitted.  Origins are echoed only after an
 * exact same-origin or allow-list match; wildcard origins are never emitted.
 */
function corsDecision(req, options = {}) {
  const originHeader = getSingleHeader(req, 'origin');
  if (originHeader === undefined) return { allowed: true, isCors: false, status: 200, reason: 'not-cors', headers: {} };
  if (originHeader === null) return { allowed: false, isCors: true, status: 400, reason: 'invalid-origin', headers: { Vary: 'Origin' } };

  const origin = parseOrigin(originHeader);
  if (!origin) return { allowed: false, isCors: true, status: 403, reason: 'untrusted-origin', headers: { Vary: 'Origin' } };

  const authority = requestAuthority(req, options);
  const sameOrigin = sameRequestOrigin(origin, authority);
  const allowedOrigins = Array.isArray(options.allowedOrigins) ? options.allowedOrigins : [];
  const explicitlyAllowed = allowedOrigins.some(item => item !== '*' && configuredOriginMatches(origin, item));
  if (!sameOrigin && !explicitlyAllowed) {
    return { allowed: false, isCors: true, status: 403, reason: 'untrusted-origin', headers: { Vary: 'Origin' } };
  }

  const requestMethodHeader = getSingleHeader(req, 'access-control-request-method');
  const preflight = String(req && req.method || '').toUpperCase() === 'OPTIONS' || requestMethodHeader !== undefined;
  if (requestMethodHeader === null) {
    return { allowed: false, isCors: true, status: 400, reason: 'invalid-request-method', headers: { Vary: corsVary(preflight) } };
  }

  const method = String(requestMethodHeader || (req && req.method) || 'GET').trim().toUpperCase();
  const allowedMethods = normalizeMethods(options.allowedMethods);
  if (!/^[A-Z]+$/.test(method) || !allowedMethods.includes(method)) {
    return { allowed: false, isCors: true, status: 405, reason: 'method-not-allowed', headers: { Vary: corsVary(preflight) } };
  }

  const allowedHeaders = normalizeHeaderNames(options.allowedHeaders);
  const requestedHeadersRaw = getSingleHeader(req, 'access-control-request-headers');
  if (requestedHeadersRaw === null) {
    return { allowed: false, isCors: true, status: 400, reason: 'invalid-request-headers', headers: { Vary: corsVary(preflight) } };
  }
  const requestedHeaders = requestedHeadersRaw === undefined || requestedHeadersRaw.trim() === ''
    ? []
    : requestedHeadersRaw.split(',').map(name => name.trim().toLowerCase());
  if (requestedHeaders.some(name => !/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name) || !allowedHeaders.includes(name))) {
    return { allowed: false, isCors: true, status: 403, reason: 'headers-not-allowed', headers: { Vary: corsVary(preflight) } };
  }

  const headers = {
    Vary: corsVary(preflight),
    'Access-Control-Allow-Origin': origin.origin,
  };
  if (options.allowCredentials === true) headers['Access-Control-Allow-Credentials'] = 'true';
  if (preflight) {
    headers['Access-Control-Allow-Methods'] = allowedMethods.join(', ');
    if (requestedHeaders.length) headers['Access-Control-Allow-Headers'] = requestedHeaders.join(', ');
    if (options.maxAge !== undefined) {
      const maxAge = Math.max(0, Math.min(86400, Math.trunc(Number(options.maxAge) || 0)));
      headers['Access-Control-Max-Age'] = String(maxAge);
    }
  }
  if (options.exposedHeaders) {
    const exposed = normalizeHeaderNames(options.exposedHeaders);
    if (exposed.length) headers['Access-Control-Expose-Headers'] = exposed.join(', ');
  }
  return { allowed: true, isCors: true, status: preflight ? 204 : 200, reason: 'allowed', headers };
}

function corsHeaders(req, options = {}) {
  const decision = corsDecision(req, options);
  return decision.allowed ? decision.headers : {};
}

module.exports = {
  JSON_BODY_ERROR,
  JsonBodyError,
  REDACTED,
  corsDecision,
  corsHeaders,
  extractRequestToken,
  isLoopbackAddress,
  isLoopbackHostname,
  isLoopbackSocketAddress,
  isSecretQueryName,
  isSensitiveName,
  isUsageTokenName,
  parseHostHeader,
  readJsonBody,
  redactSecrets,
  redactString,
  redactUrl,
  resolveStaticPath,
  timingSafeTokenEqual,
  validateBrowserRequest,

  // Exported for focused unit tests and future server integration without
  // duplicating subtly different origin/path containment rules.
  _internal: {
    extractRawPath,
    getSingleHeader,
    parseOrigin,
    pathIsInside,
    requestAuthority,
    sameRequestOrigin,
    staticPathLooksSafe,
  },
};
