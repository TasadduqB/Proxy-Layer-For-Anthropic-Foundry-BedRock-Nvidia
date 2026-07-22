'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildMigrationPlan,
  buildSafeReport,
  deriveCliToken,
  mergeImportPayload,
  parseAzureDeployment,
  saveMigrationPlan,
} = require('./src/migration/unified-migration');

const secretValues = {
  azure: 'azure-super-secret-key',
  nvidia: 'nvapi-super-secret-key',
  cloudflare: 'cloudflare-super-secret-token',
  bedrock: 'aws-super-secret-key',
  bedrockSession: 'aws-super-secret-session-token',
};
const config = {
  provider: 'nvidia',
  providers: {
    azure: {
      model: 'gpt-4.1',
      endpoint: 'https://example.openai.azure.com',
      deployment: 'gpt-4.1-deployment',
      apiVersion: '2025-04-01-preview',
      apiKey: secretValues.azure,
    },
    nvidia: {
      model: 'nvidia/nemotron-3-ultra-550b-a55b',
      endpoint: 'https://integrate.api.nvidia.com/v1',
      apiKey: secretValues.nvidia,
    },
    cloudflare: {
      model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      accountId: 'account-123',
      apiKey: secretValues.cloudflare,
    },
    bedrock: {
      model: 'anthropic.claude-sonnet',
      region: 'us-east-1',
      accessKeyId: 'AKIAEXAMPLE',
      secretAccessKey: secretValues.bedrock,
      sessionToken: secretValues.bedrockSession,
      endpoint: 'https://bedrock-runtime.us-east-1.amazonaws.com/',
    },
  },
  pool: [
    { provider: 'azure', model: 'gpt-4.1' },
    { provider: 'nvidia', model: 'nvidia/nemotron-3-ultra-550b-a55b' },
    { provider: 'cloudflare', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' },
    { provider: 'bedrock', model: 'anthropic.claude-sonnet' },
  ],
};

const now = '2026-07-21T00:00:00.000Z';
const plan = buildMigrationPlan(config, { now, source: '/private/config.json' });
assert.strictEqual(plan.schemaVersion, 1);
assert.strictEqual(plan.payload.providerConnections.length, 4);
assert.strictEqual(plan.payload.combos.length, 1);
assert.deepStrictEqual(plan.payload.combos[0].models, [
  'azure/gpt-4.1',
  'nvidia/nvidia/nemotron-3-ultra-550b-a55b',
  'cloudflare-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  'bedrock/anthropic.claude-sonnet',
]);
assert(!plan.warnings.some((warning) => warning.code === 'BEDROCK_REMAINS_LEGACY'));
const bedrockConnection = plan.payload.providerConnections.find((connection) => connection.provider === 'bedrock');
assert(bedrockConnection);
assert.strictEqual(bedrockConnection.apiKey, 'AKIAEXAMPLE');
assert.deepStrictEqual(bedrockConnection.providerSpecificData, {
  secretAccessKey: secretValues.bedrock,
  region: 'us-east-1',
  sessionToken: secretValues.bedrockSession,
  endpoint: 'https://bedrock-runtime.us-east-1.amazonaws.com',
});
const azureConnection = plan.payload.providerConnections.find((connection) => connection.provider === 'azure');
assert.deepStrictEqual(azureConnection.providerSpecificData, {
  apiType: 'chat',
  endpointMode: 'deployment',
  authMode: 'api-key',
  azureEndpoint: 'https://example.openai.azure.com',
  apiVersion: '2025-04-01-preview',
  deployment: 'gpt-4.1-deployment',
});

const reportText = JSON.stringify(buildSafeReport(plan));
for (const secret of Object.values(secretValues)) assert(!reportText.includes(secret));
assert(!reportText.includes('AKIAEXAMPLE'));
assert(JSON.stringify(plan).includes(secretValues.nvidia));

const parsedAzure = parseAzureDeployment({
  endpoint: 'https://example.openai.azure.com/openai/deployments/my-deployment/chat/completions?api-version=2025-01-01-preview',
  apiKey: 'x',
});
assert.strictEqual(parsedAzure.azureEndpoint, 'https://example.openai.azure.com');
assert.strictEqual(parsedAzure.deployment, 'my-deployment');
assert.strictEqual(parsedAzure.apiVersion, '2025-01-01-preview');
assert.strictEqual(parsedAzure.apiType, 'chat');
assert.strictEqual(parsedAzure.endpointMode, 'deployment');
assert.strictEqual(parsedAzure.authMode, 'api-key');
assert.strictEqual(parsedAzure.mappable, true);

const parsedAzureResponses = parseAzureDeployment({
  endpoint: 'https://example.test/custom/openai/responses/?api-version=2025-04-01-preview',
  model: 'o3',
});
assert.strictEqual(parsedAzureResponses.mappable, true);
assert.strictEqual(parsedAzureResponses.apiType, 'responses');
assert.strictEqual(parsedAzureResponses.endpointMode, 'full');
assert.strictEqual(parsedAzureResponses.azureEndpoint, 'https://example.test/custom/openai/responses/?api-version=2025-04-01-preview');
assert.strictEqual(parsedAzureResponses.deployment, 'o3');

const parsedDirectChat = parseAzureDeployment({
  endpoint: 'https://foundry.example.test/models',
  model: 'deepseek-r1',
});
assert.strictEqual(parsedDirectChat.mappable, true);
assert.strictEqual(parsedDirectChat.apiType, 'chat');
assert.strictEqual(parsedDirectChat.endpointMode, 'direct');
assert.strictEqual(parsedDirectChat.deployment, '');

const parsedDirectResponses = parseAzureDeployment({
  endpoint: 'https://foundry.example.test/openai/v1',
  model: 'gpt-5',
  apiType: 'responses',
  endpointMode: 'direct',
  authMode: 'bearer',
});
assert.strictEqual(parsedDirectResponses.mappable, true);
assert.strictEqual(parsedDirectResponses.apiType, 'responses');
assert.strictEqual(parsedDirectResponses.endpointMode, 'direct');
assert.strictEqual(parsedDirectResponses.authMode, 'bearer');
const inferredV1Responses = parseAzureDeployment({
  endpoint: 'https://example.openai.azure.com/openai/v1',
  model: 'gpt-5',
  responsesApi: true,
  apiKey: 'x',
});
assert.strictEqual(inferredV1Responses.mappable, true);
assert.strictEqual(inferredV1Responses.apiType, 'responses');
assert.strictEqual(inferredV1Responses.endpointMode, 'direct');
assert.strictEqual(inferredV1Responses.azureEndpoint, 'https://example.openai.azure.com/openai/v1');
assert.strictEqual(inferredV1Responses.authMode, 'api-key');
assert.strictEqual(parseAzureDeployment({
  endpoint: 'https://example.test/openai/responses?redirect=http://127.0.0.1',
}).mappable, false);

const azureResponsesPlan = buildMigrationPlan({
  providers: {
    azure: {
      model: 'gpt-5',
      endpoint: 'https://example.test/openai/v1/responses?api-version=v1',
      accessToken: 'entra-migration-secret',
      authMode: 'bearer',
      organization: '',
    },
  },
}, { now, source: 'azure-responses' });
assert.strictEqual(azureResponsesPlan.payload.providerConnections.length, 1);
assert(!azureResponsesPlan.warnings.some((warning) => /AZURE_(?:RESPONSES|DIRECT_INFERENCE)_REMAINS_LEGACY/.test(warning.code)));
assert.deepStrictEqual(azureResponsesPlan.payload.providerConnections[0].providerSpecificData, {
  apiType: 'responses',
  endpointMode: 'full',
  authMode: 'bearer',
  azureEndpoint: 'https://example.test/openai/v1/responses?api-version=v1',
  apiVersion: 'v1',
  deployment: 'gpt-5',
});
assert.strictEqual(azureResponsesPlan.payload.providerConnections[0].apiKey, '');
assert.strictEqual(azureResponsesPlan.payload.providerConnections[0].accessToken, 'entra-migration-secret');

const azureDualPlan = buildMigrationPlan({
  pool: [
    {
      provider: 'azure',
      model: 'gpt-5',
      endpoint: 'https://example.test/openai/v1',
      apiType: 'responses',
      endpointMode: 'direct',
      apiKey: 'dual-api-secret',
      accessToken: 'dual-entra-secret-a',
    },
    {
      provider: 'azure',
      model: 'gpt-5',
      endpoint: 'https://example.test/openai/v1',
      apiType: 'responses',
      endpointMode: 'direct',
      apiKey: 'dual-api-secret',
      accessToken: 'dual-entra-secret-b',
    },
  ],
}, { now, source: 'azure-dual' });
assert.strictEqual(azureDualPlan.payload.providerConnections.length, 2);
for (const [index, connection] of azureDualPlan.payload.providerConnections.entries()) {
  assert.strictEqual(connection.providerSpecificData.authMode, 'both');
  assert.strictEqual(connection.apiKey, 'dual-api-secret');
  assert.strictEqual(connection.accessToken, `dual-entra-secret-${index === 0 ? 'a' : 'b'}`);
}
const azureDualReport = JSON.stringify(buildSafeReport(azureDualPlan));
for (const secret of ['dual-api-secret', 'dual-entra-secret-a', 'dual-entra-secret-b']) {
  assert(!azureDualReport.includes(secret));
}

const customPlan = buildMigrationPlan({
  provider: 'nvidia',
  providers: { nvidia: { model: 'custom/model', endpoint: 'https://gateway.example/v1', apiKey: 'custom-key' } },
}, { now, source: 'custom' });
assert.strictEqual(customPlan.payload.providerNodes.length, 1);
assert(customPlan.payload.providerNodes[0].id.startsWith('openai-compatible-chat-'));
assert(customPlan.payload.combos[0].models[0].startsWith('proxymax-nvidia-'));

const existing = {
  settings: { requireLogin: true, comboStrategies: { existing: { fallbackStrategy: 'fallback' } } },
  providerConnections: [{ id: 'existing', provider: 'openai', apiKey: 'keep-me' }],
  providerNodes: [],
  proxyPools: [{ id: 'pool-a' }],
  apiKeys: [{ id: 'api-key-a', key: 'keep-key' }],
  combos: [{ id: 'old-combo', name: 'proxy-max-pool', models: ['old/model'] }, { id: 'keep-combo', name: 'keep', models: [] }],
  modelAliases: { keep: 'openai/model' },
  customModels: [],
  mitmAlias: {},
  pricing: {},
};
const merged = mergeImportPayload(existing, plan);
assert(merged.providerConnections.some((connection) => connection.id === 'existing' && connection.apiKey === 'keep-me'));
assert(merged.providerConnections.some((connection) => connection.id.startsWith('proxy-max-')));
assert(merged.proxyPools.some((pool) => pool.id === 'pool-a'));
assert(merged.apiKeys.some((key) => key.key === 'keep-key'));
assert(merged.combos.some((combo) => combo.name === 'keep'));
assert.strictEqual(merged.combos.filter((combo) => combo.name === 'proxy-max-pool').length, 1);
assert.strictEqual(merged.settings.requireLogin, true);
assert.strictEqual(merged.settings.comboStrategies.existing.fallbackStrategy, 'fallback');
assert.strictEqual(merged.settings.comboStrategies['proxy-max-pool'].fallbackStrategy, 'round-robin');

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-max-migration-test-'));
try {
  const saved = saveMigrationPlan(plan, { dataDir: temporaryRoot });
  assert.strictEqual(fs.statSync(saved.planPath).mode & 0o777, 0o600);
  assert.strictEqual(fs.statSync(saved.reportPath).mode & 0o777, 0o600);
  const persistedReport = fs.readFileSync(saved.reportPath, 'utf8');
  for (const secret of Object.values(secretValues)) assert(!persistedReport.includes(secret));

  fs.mkdirSync(path.join(temporaryRoot, 'auth'), { recursive: true });
  fs.writeFileSync(path.join(temporaryRoot, 'machine-id'), 'machine-value\n');
  fs.writeFileSync(path.join(temporaryRoot, 'auth', 'cli-secret'), 'cli-secret-value\n');
  const expectedToken = crypto.createHash('sha256').update('machine-value9r-cli-authcli-secret-value').digest('hex').slice(0, 16);
  assert.strictEqual(deriveCliToken(temporaryRoot), expectedToken);
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log('unified migration tests passed');
