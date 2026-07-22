'use strict';

const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  JSON_BODY_ERROR,
  REDACTED,
  corsDecision,
  corsHeaders,
  extractRequestToken,
  isLoopbackAddress,
  isLoopbackHostname,
  isLoopbackSocketAddress,
  isSensitiveName,
  isUsageTokenName,
  readJsonBody,
  redactSecrets,
  redactString,
  redactUrl,
  resolveStaticPath,
  timingSafeTokenEqual,
  validateBrowserRequest,
  _internal,
} = require('./src/security');

function request(headers = {}, method = 'GET', remoteAddress = '127.0.0.1') {
  return { headers, method, socket: { remoteAddress } };
}

function testStaticPathResolution() {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-max-security-'));
  const projectRoot = path.join(fixture, 'project');
  const outsideRoot = path.join(fixture, 'outside');
  try {
    for (const directory of ['ui/nested', 'assets', 'public', 'src', 'logs', '.git', 'ui-evil']) {
      fs.mkdirSync(path.join(projectRoot, directory), { recursive: true });
    }
    fs.mkdirSync(outsideRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'ui/index.html'), '<!doctype html>');
    fs.writeFileSync(path.join(projectRoot, 'ui/app.js'), 'console.log("safe")');
    fs.writeFileSync(path.join(projectRoot, 'ui/nested/site.css'), 'body{}');
    fs.writeFileSync(path.join(projectRoot, 'ui/config.json'), '{"secret":true}');
    fs.writeFileSync(path.join(projectRoot, 'ui/app.js.map'), '{}');
    fs.writeFileSync(path.join(projectRoot, 'assets/logo.svg'), '<svg/>');
    fs.writeFileSync(path.join(projectRoot, 'public/data.json'), '{}');
    fs.writeFileSync(path.join(projectRoot, 'src/server.js'), 'secret source');
    fs.writeFileSync(path.join(projectRoot, 'logs/proxy.log'), 'secret log');
    fs.writeFileSync(path.join(projectRoot, '.git/config'), 'secret git config');
    fs.writeFileSync(path.join(projectRoot, 'ui-evil/app.js'), 'prefix collision');
    fs.writeFileSync(path.join(outsideRoot, 'outside.js'), 'outside');
    fs.symlinkSync(path.join(outsideRoot, 'outside.js'), path.join(projectRoot, 'ui/linked.js'));

    const options = { projectRoot };
    const real = relative => fs.realpathSync(path.join(projectRoot, relative));
    assert.strictEqual(resolveStaticPath('/', options), real('ui/index.html'));
    assert.strictEqual(resolveStaticPath('/ui', options), real('ui/index.html'));
    assert.strictEqual(resolveStaticPath('/ui/app.js?v=1', options), real('ui/app.js'));
    assert.strictEqual(resolveStaticPath('/ui/nested/site.css', options), real('ui/nested/site.css'));
    assert.strictEqual(resolveStaticPath('/assets/logo.svg', options), real('assets/logo.svg'));
    assert.strictEqual(resolveStaticPath('/public/data.json', options), real('public/data.json'));

    const rejected = [
      '/package.json', '/src/server.js', '/logs/proxy.log', '/.git/config',
      '/ui/../src/server.js', '/ui/%2e%2e/src/server.js',
      '/ui/%252e%252e/src/server.js', '/ui%2f..%2fsrc/server.js',
      '/ui\\..\\src\\server.js', '/ui-evil/app.js', '/ui/.hidden.js',
      '/ui/config.json', '/ui/app.js.map', '/ui/linked.js', '/ui//app.js',
      '//example.test/ui/app.js', 'https://example.test/ui/app.js',
      '/assets', '/public/missing.js', '/ui/app.js%00.png',
    ];
    for (const target of rejected) {
      assert.strictEqual(resolveStaticPath(target, options), null, `must reject ${target}`);
    }

    assert.strictEqual(_internal.pathIsInside('/tmp/root', '/tmp/root/asset.js'), true);
    assert.strictEqual(_internal.pathIsInside('/tmp/root', '/tmp/root-evil/asset.js'), false);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

function testDeepRedaction() {
  const source = {
    apiKey: 'api-secret',
    API_TOKEN: 'api-token-secret',
    password: 'hunter2',
    aws_secret_access_key: 'aws-secret',
    subscriptionKey: 'subscription-secret',
    'x-goog-api-key': 'google-api-secret',
    'ocp-apim-subscription-key': 'apim-subscription-secret',
    'x-functions-key': 'functions-secret',
    sasToken: 'sas-token-secret',
    connectionString: 'Server=db;User ID=admin;Password=db-secret',
    serviceAccountJson: { private_key: 'service-account-private-key' },
    clientCertificate: 'client-certificate-secret',
    certificate: 'certificate-secret',
    webhookSecret: 'webhook-secret',
    nested: [{ authorization: 'Bearer nested-secret' }, 'Bearer loose-secret'],
    usage: {
      input_tokens: 101,
      output_tokens: 22,
      prompt_tokens: 77,
      completion_tokens: 9,
      total_tokens: 110,
      max_tokens: 4096,
      token_count: 110,
      tokens_saved: 12,
    },
    largeCounter: 9007199254740993n,
    endpoint: new URL('https://alice:password@example.test/v1?api_key=url-secret&input_tokens=12'),
  };
  source.self = source;

  let getterCalled = false;
  Object.defineProperty(source, 'clientSecret', {
    enumerable: true,
    get() {
      getterCalled = true;
      return 'getter-secret';
    },
  });

  const safe = redactSecrets(source);
  assert.strictEqual(source.apiKey, 'api-secret', 'redaction must not mutate the source');
  assert.strictEqual(safe.apiKey, REDACTED);
  assert.strictEqual(safe.API_TOKEN, REDACTED);
  assert.strictEqual(safe.password, REDACTED);
  assert.strictEqual(safe.aws_secret_access_key, REDACTED);
  for (const field of [
    'subscriptionKey', 'x-goog-api-key', 'ocp-apim-subscription-key',
    'x-functions-key', 'sasToken', 'connectionString', 'serviceAccountJson',
    'clientCertificate', 'certificate', 'webhookSecret',
  ]) {
    assert.strictEqual(safe[field], REDACTED, `must deeply redact ${field}`);
  }
  assert.strictEqual(safe.nested[0].authorization, REDACTED);
  assert.strictEqual(safe.nested[1], `Bearer ${REDACTED}`);
  assert.deepStrictEqual(safe.usage, source.usage, 'ordinary usage counters must survive');
  assert(!safe.endpoint.includes('alice'));
  assert(!safe.endpoint.includes('password'));
  assert(!safe.endpoint.includes('url-secret'));
  assert(safe.endpoint.includes('input_tokens=12'));
  assert.strictEqual(safe.self, '[Circular]');
  assert.strictEqual(safe.clientSecret, REDACTED);
  assert.strictEqual(safe.largeCounter, '9007199254740993');
  assert.doesNotThrow(() => JSON.stringify(safe), 'redacted output must be JSON-safe');
  assert.strictEqual(getterCalled, false, 'redaction must not invoke getters');

  assert.strictEqual(isSensitiveName('access_token'), true);
  assert.strictEqual(isSensitiveName('github_token'), true);
  assert.strictEqual(isSensitiveName('api_tokens'), true);
  assert.strictEqual(isSensitiveName('dashboardToken'), true);
  assert.strictEqual(isSensitiveName('subscriptionKey'), true);
  assert.strictEqual(isSensitiveName('x-goog-api-key'), true);
  assert.strictEqual(isSensitiveName('ocp-apim-subscription-key'), true);
  assert.strictEqual(isSensitiveName('x-functions-key'), true);
  assert.strictEqual(isSensitiveName('connectionString'), true);
  assert.strictEqual(isSensitiveName('serviceAccountJson'), true);
  assert.strictEqual(isSensitiveName('clientCertificate'), true);
  assert.strictEqual(isSensitiveName('certificate'), true);
  assert.strictEqual(isSensitiveName('webhookSecret'), true);
  assert.strictEqual(isSensitiveName('input_tokens'), false);
  assert.strictEqual(isSensitiveName('max_tokens'), false);
  assert.strictEqual(isUsageTokenName('cache_read_input_tokens'), true);
  assert.strictEqual(isUsageTokenName('tokens_saved'), true);
}

function testStringAndUrlRedaction() {
  const raw = [
    'Authorization: Bearer auth-secret',
    'Proxy-Authorization: Basic dXNlcjpwYXNz',
    'Cookie: sid=cookie-secret; theme=dark',
    'Set-Cookie: session=set-cookie-secret; HttpOnly',
    'Ocp-Apim-Subscription-Key: header-apim-secret',
    'X-Goog-Api-Key: header-google-secret',
    'X-Functions-Key: header-functions-secret',
    'api_key=assignment-secret password:password-secret',
    'github_token=github-token-secret oauth_tokens=oauth-token-secret',
    'password = "quoted password secret"',
    'AWS_ACCESS_KEY_ID=example-access-key-id',
    'AWS_SECRET_ACCESS_KEY=example-secret-access-key',
    '--api-key cli-secret --token=cli-token-secret',
    'raw key sk-proj-abcdefghijklmnopqrstuv',
    'jwt eyJabcdefghijk.abcdefghijkl.abcdefghijkl',
    'url https://alice:url-password@example.test/v1?api%5Fkey=query-secret&input_tokens=42',
    'relative /callback?api%5Fkey=relative-query-secret&page=3',
    'credential URL https://api.example/v1?subscription-key=url-subscription-secret&x-goog-api-key=url-google-secret&sasToken=url-sas-secret&input_tokens=42&max_tokens=8',
  ].join('\n');
  const safe = redactString(raw);
  assert(!safe.includes(`${REDACTED}]`), 'redaction markers must remain well formed');
  assert.strictEqual(redactString(safe), safe, 'string redaction must be idempotent');
  for (const secret of [
    'auth-secret', 'dXNlcjpwYXNz', 'cookie-secret', 'set-cookie-secret',
    'header-apim-secret', 'header-google-secret', 'header-functions-secret',
    'assignment-secret', 'password-secret', 'example-access-key-id',
    'github-token-secret', 'oauth-token-secret',
    'quoted password secret', 'relative-query-secret',
    'url-subscription-secret', 'url-google-secret', 'url-sas-secret',
    'example-secret-access-key', 'cli-secret',
    'cli-token-secret', 'sk-proj-abcdefghijklmnopqrstuv',
    'eyJabcdefghijk.abcdefghijkl.abcdefghijkl', 'alice', 'url-password',
    'query-secret',
  ]) {
    assert(!safe.includes(secret), `must redact ${secret}`);
  }
  assert(safe.includes('input_tokens=42'), 'usage query parameters are not credentials');
  assert(safe.includes('max_tokens=8'), 'max token counters are not credentials');
  assert(safe.includes(REDACTED));

  const escapedJson = '{"password":"abc\\"still-secret","input_tokens":12}';
  const safeJson = redactString(escapedJson);
  assert(!safeJson.includes('still-secret'));
  assert(safeJson.includes('"input_tokens":12'));

  const usage = 'input_tokens=123 output_tokens: 44 max_tokens=8 total_tokens=167 token_count=167';
  assert.strictEqual(redactString(usage), usage);

  const safeUrl = redactUrl('https://user:pass@example.test/path?access_token=top-secret&page=2#refresh_token=second-secret');
  assert(!safeUrl.includes('user'));
  assert(!safeUrl.includes('pass'));
  assert(!safeUrl.includes('top-secret'));
  assert(!safeUrl.includes('second-secret'));
  assert(safeUrl.includes('page=2'));

  const pem = 'before -----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY----- after';
  assert.strictEqual(redactString(pem), `before ${REDACTED} after`);
}

function testBrowserValidation() {
  const sameOrigin = request({
    host: '127.0.0.1:8787',
    origin: 'http://127.0.0.1:8787',
    'sec-fetch-site': 'same-origin',
  }, 'POST');
  assert.strictEqual(validateBrowserRequest(sameOrigin).ok, true);

  assert.deepStrictEqual(
    validateBrowserRequest(request({ host: 'localhost.evil:8787', origin: 'http://localhost.evil:8787' })),
    { ok: false, status: 403, reason: 'untrusted-host' },
  );
  assert.strictEqual(validateBrowserRequest(request({
    host: 'localhost:8787',
    origin: 'https://evil.example',
    'sec-fetch-site': 'cross-site',
  })).reason, 'untrusted-origin');
  assert.strictEqual(validateBrowserRequest(request({
    host: 'localhost:8787',
    origin: 'http://localhost:8787',
    'sec-fetch-site': 'same-site',
  })).reason, 'cross-site-request');
  assert.strictEqual(validateBrowserRequest(request({
    host: 'localhost:8787',
    'sec-fetch-site': 'none',
  }, 'GET')).ok, true);
  assert.strictEqual(validateBrowserRequest(request({
    host: 'localhost:8787',
    'sec-fetch-site': 'cross-site',
  }, 'POST')).reason, 'cross-site-request');

  const tokenOptions = { token: 'dashboard-secret' };
  assert.strictEqual(validateBrowserRequest(sameOrigin, tokenOptions).status, 401);
  assert.strictEqual(validateBrowserRequest(request({
    ...sameOrigin.headers,
    'x-proxy-max-token': 'wrong',
  }, 'POST'), tokenOptions).status, 401);
  const authorized = validateBrowserRequest(request({
    ...sameOrigin.headers,
    'x-proxy-max-admin-token': 'dashboard-secret',
  }, 'POST', '203.0.113.10'), tokenOptions);
  assert.strictEqual(authorized.ok, true);
  assert.strictEqual(authorized.authenticated, true);

  const spoofedLocalHost = request({
    ...sameOrigin.headers,
  }, 'POST', '203.0.113.10');
  assert.strictEqual(validateBrowserRequest(spoofedLocalHost).reason, 'non-local-client');
  assert.strictEqual(validateBrowserRequest(request({
    ...sameOrigin.headers,
    'x-proxy-max-admin-token': 'dashboard-secret',
  }, 'POST', '203.0.113.10'), tokenOptions).ok, true);

  const bearerRequest = request({
    ...sameOrigin.headers,
    authorization: 'Bearer dashboard-secret',
  }, 'POST');
  assert.strictEqual(extractRequestToken(bearerRequest), 'dashboard-secret');
  assert.strictEqual(validateBrowserRequest(bearerRequest, tokenOptions).ok, true);

  const ambiguous = request({
    ...sameOrigin.headers,
    authorization: 'Bearer dashboard-secret',
    'x-proxy-max-token': 'different-secret',
  }, 'POST');
  assert.strictEqual(extractRequestToken(ambiguous), null);
  assert.strictEqual(validateBrowserRequest(ambiguous, tokenOptions).status, 401);

  assert.strictEqual(validateBrowserRequest(request({
    host: 'proxy.internal:8443',
    origin: 'http://proxy.internal:8443',
    'sec-fetch-site': 'same-origin',
  }), { allowedHosts: ['proxy.internal:8443'], allowTokenlessRemote: true }).ok, true);
  assert.strictEqual(validateBrowserRequest(request({
    host: '[::1]:8787',
    origin: 'http://[::1]:8787',
    'sec-fetch-site': 'same-origin',
  })).ok, true);

  assert.strictEqual(isLoopbackHostname('127.255.1.2'), true);
  assert.strictEqual(isLoopbackHostname('127.999.1.2'), false);
  assert.strictEqual(isLoopbackHostname('localhost.evil'), false);
  assert.strictEqual(isLoopbackAddress('127.0.0.1'), true);
  assert.strictEqual(isLoopbackAddress('127.255.10.20'), true);
  assert.strictEqual(isLoopbackAddress('::1'), true);
  assert.strictEqual(isLoopbackAddress('0:0:0:0:0:0:0:1'), true);
  assert.strictEqual(isLoopbackAddress('::ffff:127.0.0.1'), true);
  assert.strictEqual(isLoopbackAddress('::ffff:127.25.2.3'), true);
  assert.strictEqual(isLoopbackAddress('::ffff:7f00:1'), true);
  assert.strictEqual(isLoopbackAddress('::ffff:192.168.1.1'), false);
  assert.strictEqual(isLoopbackAddress('192.168.1.1'), false);
  assert.strictEqual(isLoopbackAddress('::2'), false);
  assert.strictEqual(isLoopbackSocketAddress({ remoteAddress: '::1' }), true);
  assert.strictEqual(isLoopbackSocketAddress({ socket: { remoteAddress: '203.0.113.9' } }), false);
  assert.strictEqual(timingSafeTokenEqual('same-value', 'same-value'), true);
  assert.strictEqual(timingSafeTokenEqual('same-value', 'same-valuE'), false);
  assert.strictEqual(timingSafeTokenEqual('short', 'shorter'), false);
}

function testCorsDecisions() {
  const nonCors = corsDecision(request({ host: 'localhost:8787' }));
  assert.strictEqual(nonCors.allowed, true);
  assert.deepStrictEqual(nonCors.headers, {});

  const sameOrigin = request({ host: 'localhost:8787', origin: 'http://localhost:8787' }, 'POST');
  const allowed = corsDecision(sameOrigin);
  assert.strictEqual(allowed.allowed, true);
  assert.strictEqual(allowed.headers['Access-Control-Allow-Origin'], 'http://localhost:8787');
  assert.notStrictEqual(allowed.headers['Access-Control-Allow-Origin'], '*');
  assert.strictEqual(allowed.headers['Access-Control-Allow-Credentials'], undefined);

  const untrusted = request({ host: 'localhost:8787', origin: 'https://evil.example' }, 'POST');
  assert.strictEqual(corsDecision(untrusted).allowed, false);
  assert.deepStrictEqual(corsHeaders(untrusted), {});
  assert.strictEqual(corsDecision(untrusted, { allowedOrigins: ['*'] }).allowed, false);

  const preflight = request({
    host: 'localhost:8787',
    origin: 'https://console.example',
    'access-control-request-method': 'POST',
    'access-control-request-headers': 'Content-Type, X-Proxy-Max-Token',
  }, 'OPTIONS');
  const preflightDecision = corsDecision(preflight, {
    allowedOrigins: ['https://console.example'],
    allowedMethods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['content-type', 'x-proxy-max-token'],
    allowCredentials: true,
    maxAge: 999999,
  });
  assert.strictEqual(preflightDecision.allowed, true);
  assert.strictEqual(preflightDecision.status, 204);
  assert.strictEqual(preflightDecision.headers['Access-Control-Allow-Origin'], 'https://console.example');
  assert.strictEqual(preflightDecision.headers['Access-Control-Allow-Credentials'], 'true');
  assert.strictEqual(preflightDecision.headers['Access-Control-Max-Age'], '86400');
  assert.strictEqual(preflightDecision.headers['Access-Control-Allow-Headers'], 'content-type, x-proxy-max-token');

  const forbiddenHeader = request({
    ...preflight.headers,
    'access-control-request-headers': 'Content-Type, X-Unapproved-Header',
  }, 'OPTIONS');
  assert.strictEqual(corsDecision(forbiddenHeader, {
    allowedOrigins: ['https://console.example'],
    allowedHeaders: ['content-type'],
  }).reason, 'headers-not-allowed');

  const forbiddenMethod = request({
    ...preflight.headers,
    'access-control-request-method': 'DELETE',
  }, 'OPTIONS');
  assert.strictEqual(corsDecision(forbiddenMethod, {
    allowedOrigins: ['https://console.example'],
  }).reason, 'method-not-allowed');
  assert.strictEqual(corsDecision(request({ host: 'localhost:8787', origin: 'null' })).allowed, false);
  assert.strictEqual(corsDecision(request({ host: 'localhost:8787', origin: 'https://localhost:8787' })).allowed, false);
}

class FakeRequest extends EventEmitter {
  constructor(headers = {}) {
    super();
    this.headers = headers;
    this.method = 'POST';
    this.destroyed = false;
    this.resumed = false;
  }

  resume() {
    this.resumed = true;
  }
}

async function expectBodyError(promise, definition) {
  await assert.rejects(promise, error => {
    assert.strictEqual(error.name, 'JsonBodyError');
    assert.strictEqual(error.status, definition.status);
    assert.strictEqual(error.statusCode, definition.status);
    assert.strictEqual(error.code, definition.code);
    assert.strictEqual(error.message, definition.message);
    return true;
  });
}

async function testBoundedJsonReader() {
  const valid = new FakeRequest({ 'content-length': '17' });
  const validPromise = readJsonBody(valid, { maxBytes: 17 });
  valid.emit('data', Buffer.from('{"hello":'));
  valid.emit('data', Buffer.from('"world"}'));
  valid.emit('end');
  assert.deepStrictEqual(await validPromise, { hello: 'world' });

  const exactLimit = new FakeRequest({ 'transfer-encoding': 'chunked' });
  const exactPromise = readJsonBody(exactLimit, { maxBytes: 7 });
  exactLimit.emit('data', '{"a":1}');
  exactLimit.emit('end');
  assert.deepStrictEqual(await exactPromise, { a: 1 });

  const declaredOversize = new FakeRequest({ 'content-length': '11' });
  const declaredPromise = readJsonBody(declaredOversize, { maxBytes: 10 });
  assert.strictEqual(declaredOversize.listenerCount('data'), 0, 'precheck must happen before buffering');
  assert.strictEqual(declaredOversize.resumed, true, 'oversized requests are drained without retention');
  await expectBodyError(declaredPromise, JSON_BODY_ERROR.TOO_LARGE);

  const streamedOversize = new FakeRequest({ 'transfer-encoding': 'chunked' });
  const streamedPromise = readJsonBody(streamedOversize, { maxBytes: 10 });
  streamedOversize.emit('data', Buffer.alloc(8, 0x20));
  streamedOversize.emit('data', Buffer.alloc(8, 0x20));
  assert.strictEqual(streamedOversize.resumed, true);
  assert.strictEqual(streamedOversize.listenerCount('data'), 0);
  await expectBodyError(streamedPromise, JSON_BODY_ERROR.TOO_LARGE);

  const invalidJson = new FakeRequest({});
  const invalidJsonPromise = readJsonBody(invalidJson, { maxBytes: 100 });
  invalidJson.emit('data', '{bad json');
  invalidJson.emit('end');
  await expectBodyError(invalidJsonPromise, JSON_BODY_ERROR.BAD_REQUEST);

  const invalidUtf8 = new FakeRequest({});
  const invalidUtf8Promise = readJsonBody(invalidUtf8, { maxBytes: 100 });
  invalidUtf8.emit('data', Buffer.from([0xff]));
  invalidUtf8.emit('end');
  await expectBodyError(invalidUtf8Promise, JSON_BODY_ERROR.BAD_REQUEST);

  for (const headers of [
    { 'content-length': '1x' },
    { 'content-length': ['1', '1'] },
    { 'content-length': '2', 'transfer-encoding': 'chunked' },
    { 'transfer-encoding': 'gzip' },
  ]) {
    const malformed = new FakeRequest(headers);
    await expectBodyError(readJsonBody(malformed, { maxBytes: 100 }), JSON_BODY_ERROR.BAD_REQUEST);
    assert.strictEqual(malformed.resumed, true);
  }

  const lengthMismatch = new FakeRequest({ 'content-length': '20' });
  const mismatchPromise = readJsonBody(lengthMismatch, { maxBytes: 100 });
  lengthMismatch.emit('data', '{}');
  lengthMismatch.emit('end');
  await expectBodyError(mismatchPromise, JSON_BODY_ERROR.BAD_REQUEST);

  const empty = new FakeRequest({ 'content-length': '0' });
  const emptyPromise = readJsonBody(empty, { maxBytes: 100 });
  empty.emit('end');
  assert.deepStrictEqual(await emptyPromise, {});

  const forbiddenEmpty = new FakeRequest({ 'content-length': '0' });
  const forbiddenEmptyPromise = readJsonBody(forbiddenEmpty, { maxBytes: 100, allowEmpty: false });
  forbiddenEmpty.emit('end');
  await expectBodyError(forbiddenEmptyPromise, JSON_BODY_ERROR.BAD_REQUEST);

  const aborted = new FakeRequest({});
  const abortedPromise = readJsonBody(aborted, { maxBytes: 100 });
  aborted.emit('aborted');
  await expectBodyError(abortedPromise, JSON_BODY_ERROR.BAD_REQUEST);

  assert.throws(() => readJsonBody(new FakeRequest(), { maxBytes: 0 }), /positive safe integer/);
}

async function main() {
  testStaticPathResolution();
  testDeepRedaction();
  testStringAndUrlRedaction();
  testBrowserValidation();
  testCorsDecisions();
  await testBoundedJsonReader();
  console.log('security tests passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
