'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  DEFAULT_HOST,
  reservePort,
  resolveDataDir,
  spawnUnified,
  waitForHealth,
} = require('../runtime/unified-runtime');
const { deriveCliToken } = require('../runtime/cli-auth');
const { resolvePoolMember } = require('../routing/pool-routing');

const ROOT = path.resolve(__dirname, '../..');
const MIGRATION_SCHEMA_VERSION = 1;
const PLAN_FILE = `proxy-max-to-unified-v${MIGRATION_SCHEMA_VERSION}.private.json`;
const REPORT_FILE = `proxy-max-to-unified-v${MIGRATION_SCHEMA_VERSION}.report.json`;
const STANDARD_NVIDIA_ENDPOINT = 'https://integrate.api.nvidia.com/v1';

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const key of Object.keys(value).sort()) output[key] = stableValue(value[key]);
  return output;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function digest(value, length = 64) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : stableJson(value)).digest('hex').slice(0, length);
}

function slug(value, fallback = 'provider') {
  const result = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return result || fallback;
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function readLegacyConfig(options = {}) {
  const env = options.env || process.env;
  if (env.PROXY_MAX_CONFIG_JSON) {
    return {
      config: JSON.parse(env.PROXY_MAX_CONFIG_JSON),
      source: 'PROXY_MAX_CONFIG_JSON',
    };
  }
  const configPath = path.resolve(options.configPath || env.PROXY_MAX_CONFIG || path.join(ROOT, 'config.json'));
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return { config, source: configPath };
}

function allLegacyEntries(config) {
  const providers = config && typeof config.providers === 'object' && config.providers ? config.providers : {};
  const entries = [];

  for (const [provider, providerConfig] of Object.entries(providers)) {
    if (!providerConfig || typeof providerConfig !== 'object') continue;
    entries.push({ ...providerConfig, provider, kind: provider, _source: `providers.${provider}` });
  }

  if (Array.isArray(config?.pool)) {
    config.pool.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') return;
      const resolved = resolvePoolMember(entry, providers);
      entries.push({ ...resolved, _source: `pool[${index}]`, _poolIndex: index });
    });
  }

  if (entries.length === 0 && config?.provider) {
    const resolved = resolvePoolMember({ provider: config.provider }, providers);
    entries.push({ ...resolved, _source: 'active-provider' });
  }
  return entries;
}

const AZURE_API_TYPES = new Set(['chat', 'responses']);
const AZURE_ENDPOINT_MODES = new Set(['deployment', 'direct', 'full']);
const AZURE_AUTH_MODES = new Set(['api-key', 'bearer', 'both']);
const AZURE_RESPONSES_ONLY_MODELS = new Set(['o3', 'o4-mini']);

function normalizeAzureChoice(value, allowed, aliases = {}) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  const normalized = aliases[raw] || raw;
  return allowed.has(normalized) ? normalized : null;
}

function parseAzureDeployment(config) {
  const endpoint = String(config.endpoint || config.azureEndpoint || '').trim();
  const configuredDeployment = String(config.deployment || '').trim();
  const model = String(config.model || '').trim();
  let deployment = configuredDeployment;
  let apiVersion = String(config.apiVersion || '').trim();
  let azureEndpoint = endpoint;
  let apiType = normalizeAzureChoice(config.apiType, AZURE_API_TYPES);
  let endpointMode = normalizeAzureChoice(config.endpointMode, AZURE_ENDPOINT_MODES);
  const explicitAuthMode = normalizeAzureChoice(config.authMode, AZURE_AUTH_MODES, {
    apikey: 'api-key',
    api_key: 'api-key',
    entra: 'bearer',
    'entra-token': 'bearer',
    token: 'bearer',
  });
  const hasApiKey = Boolean(String(config.apiKey || '').trim());
  const hasAccessToken = Boolean(String(config.accessToken || config.entraToken || '').trim());
  const authMode = explicitAuthMode || (
    hasApiKey && hasAccessToken ? 'both' : (hasAccessToken ? 'bearer' : 'api-key')
  );
  let valid = Boolean(endpoint) && apiType !== null && endpointMode !== null && explicitAuthMode !== null;
  let fullPathType = '';
  if (endpoint.length > 16 * 1024 || /[\r\n\0]/.test(endpoint)) valid = false;

  if (endpoint) {
    try {
      const parsed = new URL(endpoint);
      const queryKeys = [...parsed.searchParams.keys()];
      if (
        !['http:', 'https:'].includes(parsed.protocol) ||
        parsed.username || parsed.password || endpoint.includes('#') || parsed.hash ||
        queryKeys.some((key) => key !== 'api-version') ||
        parsed.searchParams.getAll('api-version').length > 1 ||
        (queryKeys.includes('api-version') && !String(parsed.searchParams.get('api-version') || '').trim())
      ) {
        valid = false;
      }

      const path = parsed.pathname;
      const deploymentMatch = path.match(/^(.*)\/openai\/deployments\/([^/]+)\/(?:chat\/completions|completions)\/?$/i);
      if (deploymentMatch) {
        azureEndpoint = `${parsed.origin}${deploymentMatch[1]}`.replace(/\/+$/, '');
        deployment = deployment || decodeURIComponent(deploymentMatch[2]);
        apiType = apiType || 'chat';
        endpointMode = endpointMode || 'deployment';
        if (apiType !== 'chat' || endpointMode !== 'deployment') valid = false;
      } else if (/\/responses\/?$/i.test(path)) {
        fullPathType = 'responses';
        apiType = apiType || 'responses';
        endpointMode = endpointMode || 'full';
        if (apiType !== 'responses' || endpointMode !== 'full') valid = false;
      } else if (/\/chat\/completions\/?$/i.test(path)) {
        fullPathType = 'chat';
        apiType = apiType || 'chat';
        endpointMode = endpointMode || 'full';
        if (apiType !== 'chat' || endpointMode !== 'full') valid = false;
      } else {
        apiType = apiType || (
          config.responsesApi === true || AZURE_RESPONSES_ONLY_MODELS.has((configuredDeployment || model).toLowerCase())
            ? 'responses'
            : 'chat'
        );
        const isCurrentResponsesBase = apiType === 'responses' && /\/openai\/v1\/?$/i.test(path);
        endpointMode = endpointMode || (
          isCurrentResponsesBase
            ? 'direct'
            : (apiType === 'responses' || configuredDeployment ? 'deployment' : 'direct')
        );
        if (endpointMode === 'full') valid = false;
      }

      apiVersion = parsed.searchParams.get('api-version') || apiVersion;
    } catch {
      valid = false;
    }
  }

  apiType = apiType || 'chat';
  endpointMode = endpointMode || (deployment ? 'deployment' : 'direct');
  if (apiType === 'responses' && !deployment) deployment = configuredDeployment || model;
  if (endpointMode === 'deployment' && apiType === 'chat' && !deployment) deployment = model;
  if (endpointMode === 'deployment' && apiType === 'chat' && !deployment) valid = false;
  if (endpointMode === 'full' && fullPathType !== apiType) valid = false;
  if (deployment.length > 512 || /[\0-\x1f\x7f]/.test(deployment)) valid = false;
  if (apiVersion.length > 256 || /[\0-\x1f\x7f]/.test(apiVersion)) valid = false;
  const organization = String(config.organization || '').trim();
  if (organization.length > 16 * 1024 || /[\r\n\0]/.test(organization)) valid = false;

  return {
    apiType,
    endpointMode,
    authMode,
    azureEndpoint,
    deployment,
    apiVersion: apiVersion || '2024-10-21',
    organization,
    responsesApi: apiType === 'responses',
    directInference: endpointMode === 'direct',
    mappable: Boolean(valid && azureEndpoint),
  };
}

function customOpenAiNode(config, legacyProvider, now) {
  const endpoint = normalizeBaseUrl(config.endpoint || config.baseUrl);
  if (!endpoint || !config.apiKey) return null;
  const apiType = /(?:^|\/)responses\/?(?:\?|$)/i.test(endpoint) ? 'responses' : 'chat';
  let baseUrl = endpoint;
  if (apiType === 'responses') baseUrl = baseUrl.replace(/\/responses\/?(?:\?.*)?$/i, '');
  else baseUrl = baseUrl.replace(/\/chat\/completions\/?(?:\?.*)?$/i, '');
  const identity = digest({ legacyProvider, baseUrl, apiType }, 10);
  const prefix = `proxymax-${slug(legacyProvider)}-${identity}`;
  const id = `openai-compatible-${apiType}-${identity}`;
  return {
    node: {
      id,
      type: 'openai-compatible',
      name: `Proxy-Max ${legacyProvider}`,
      prefix,
      apiType,
      baseUrl,
      createdAt: now,
      updatedAt: now,
    },
    provider: id,
    prefix,
    providerSpecificData: {
      prefix,
      apiType,
      baseUrl,
      nodeName: `Proxy-Max ${legacyProvider}`,
    },
  };
}

function mapEntry(config, index, now) {
  const legacyProvider = slug(config.provider || config.kind || '');
  const model = String(config.model || config.deployment || '').trim();
  const warnings = [];
  let provider = legacyProvider;
  let prefix = provider;
  let apiKey = String(config.apiKey || '').trim();
  let accessToken = '';
  let providerSpecificData = {};
  let node = null;
  let supported = true;

  if (legacyProvider === 'azure') {
    apiKey = String(config.apiKey || '').trim();
    accessToken = String(config.accessToken || config.entraToken || '').trim();
    const azure = parseAzureDeployment(config);
    if (!apiKey && !accessToken) {
      supported = false;
      warnings.push({ code: 'AZURE_API_KEY_MISSING', source: config._source, message: 'Azure entry has no API key or Entra token and was not imported.' });
    } else if (!azure.mappable) {
      supported = false;
      warnings.push({ code: 'AZURE_CONFIGURATION_INVALID', source: config._source, message: 'Azure entry has an invalid or unsupported endpoint configuration and was not imported.' });
    } else {
      provider = 'azure';
      prefix = 'azure';
      providerSpecificData = {
        apiType: azure.apiType,
        endpointMode: azure.endpointMode,
        authMode: azure.authMode,
        azureEndpoint: azure.azureEndpoint,
        apiVersion: azure.apiVersion,
        ...(azure.deployment ? { deployment: azure.deployment } : {}),
        ...(azure.organization ? { organization: azure.organization } : {}),
      };
    }
  } else if (legacyProvider === 'nvidia') {
    const endpoint = normalizeBaseUrl(config.endpoint || STANDARD_NVIDIA_ENDPOINT);
    if (!apiKey) {
      supported = false;
      warnings.push({ code: 'NVIDIA_API_KEY_MISSING', source: config._source, message: 'NVIDIA entry has no API key and was not imported.' });
    } else if (endpoint === STANDARD_NVIDIA_ENDPOINT) {
      provider = 'nvidia';
      prefix = 'nvidia';
    } else {
      const custom = customOpenAiNode({ ...config, endpoint }, legacyProvider, now);
      if (!custom) supported = false;
      else {
        ({ provider, prefix, providerSpecificData, node } = custom);
        warnings.push({ code: 'NVIDIA_CUSTOM_ENDPOINT_NODE', source: config._source, message: 'Custom NVIDIA endpoint was mapped to an isolated OpenAI-compatible provider node.' });
      }
    }
  } else if (legacyProvider === 'cloudflare') {
    provider = 'cloudflare-ai';
    prefix = 'cloudflare-ai';
    providerSpecificData = { accountId: String(config.accountId || '').trim() };
    if (!apiKey || !providerSpecificData.accountId) {
      supported = false;
      warnings.push({ code: 'CLOUDFLARE_CREDENTIALS_INCOMPLETE', source: config._source, message: 'Cloudflare entry requires both API token and account ID and was not imported.' });
    }
  } else if (legacyProvider === 'bedrock') {
    provider = 'bedrock';
    prefix = 'bedrock';
    apiKey = String(config.accessKeyId || config.apiKey || '').trim();
    const secretAccessKey = String(config.secretAccessKey || '').trim();
    const sessionToken = String(config.sessionToken || '').trim();
    const region = String(config.region || 'us-east-1').trim();
    const endpoint = normalizeBaseUrl(config.endpoint);
    providerSpecificData = {
      secretAccessKey,
      region,
      ...(sessionToken ? { sessionToken } : {}),
      ...(endpoint ? { endpoint } : {}),
    };
    if (!apiKey || !secretAccessKey) {
      supported = false;
      warnings.push({ code: 'BEDROCK_CREDENTIALS_INCOMPLETE', source: config._source, message: 'AWS Bedrock requires both an access key ID and secret access key and was not imported.' });
    }
  } else {
    const custom = customOpenAiNode(config, legacyProvider, now);
    if (!custom) {
      supported = false;
      warnings.push({ code: 'PROVIDER_REMAINS_LEGACY', source: config._source, message: `Provider '${legacyProvider}' has no safe automatic mapping and remains on the legacy runtime.` });
    } else {
      ({ provider, prefix, providerSpecificData, node } = custom);
      warnings.push({ code: 'CUSTOM_PROVIDER_NODE', source: config._source, message: `Provider '${legacyProvider}' was mapped to an OpenAI-compatible provider node.` });
    }
  }

  if (!supported || !model) {
    if (supported && !model) warnings.push({ code: 'MODEL_MISSING', source: config._source, message: 'Entry has no model and was not imported.' });
    return { supported: false, warnings };
  }

  const nonSecretIdentity = {
    legacyProvider,
    provider,
    endpoint: normalizeBaseUrl(config.endpoint || config.baseUrl || providerSpecificData.azureEndpoint),
    accountId: providerSpecificData.accountId || '',
    source: config._source,
    index,
  };
  const id = `proxy-max-${digest(nonSecretIdentity, 24)}`;
  const connection = {
    id,
    provider,
    authType: 'apikey',
    name: String(config.label || `Proxy-Max ${legacyProvider} ${index + 1}`),
    priority: Number.isFinite(Number(config.priority)) ? Number(config.priority) : index + 1,
    isActive: config.enabled !== false && config.disabled !== true,
    apiKey,
    ...(accessToken ? { accessToken } : {}),
    defaultModel: model,
    providerSpecificData,
    testStatus: 'unknown',
    createdAt: now,
    updatedAt: now,
  };
  const credentialFingerprint = digest({
    provider,
    apiKey,
    accessToken,
    providerSpecificData,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    sessionToken: config.sessionToken,
  });
  return {
    supported: true,
    warnings,
    node,
    connection,
    credentialFingerprint,
    comboModel: `${prefix}/${model}`,
    legacyProvider,
    source: config._source,
  };
}

function buildMigrationPlan(config, options = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new TypeError('Proxy-Max config must be an object.');
  const now = options.now || new Date().toISOString();
  const source = options.source || 'config.json';
  const entries = allLegacyEntries(config);
  const warnings = [];
  const connections = [];
  const providerNodes = [];
  const comboModels = [];
  const seenCredentials = new Map();
  const seenNodes = new Set();
  const poolSources = new Set((Array.isArray(config.pool) ? config.pool : []).map((_, index) => `pool[${index}]`));

  entries.forEach((entry, index) => {
    const mapped = mapEntry(entry, index, now);
    warnings.push(...mapped.warnings);
    if (!mapped.supported) return;
    if (mapped.node && !seenNodes.has(mapped.node.id)) {
      seenNodes.add(mapped.node.id);
      providerNodes.push(mapped.node);
    }

    let connection = seenCredentials.get(mapped.credentialFingerprint);
    if (!connection) {
      connection = mapped.connection;
      seenCredentials.set(mapped.credentialFingerprint, connection);
      connections.push(connection);
    } else if (mapped.connection.priority < connection.priority) {
      connection.priority = mapped.connection.priority;
    }

    if (poolSources.has(mapped.source) && !comboModels.includes(mapped.comboModel)) comboModels.push(mapped.comboModel);
  });

  if (comboModels.length === 0) {
    for (const connection of connections) {
      const prefix = providerNodes.find((node) => node.id === connection.provider)?.prefix || connection.provider;
      const value = `${prefix}/${connection.defaultModel}`;
      if (!comboModels.includes(value)) comboModels.push(value);
    }
  }

  const comboId = `proxy-max-combo-${digest({ source, models: comboModels }, 16)}`;
  const combos = comboModels.length > 0 ? [{
    id: comboId,
    name: 'proxy-max-pool',
    kind: 'llm',
    models: comboModels,
    createdAt: now,
    updatedAt: now,
  }] : [];

  const plan = {
    schemaVersion: MIGRATION_SCHEMA_VERSION,
    generatedAt: now,
    source,
    sourceHash: digest(config),
    payload: {
      providerConnections: connections,
      providerNodes,
      combos,
      settingsPatch: {
        comboStrategy: 'round-robin',
        comboStickyRoundRobinLimit: 1,
        comboStrategies: {
          'proxy-max-pool': { fallbackStrategy: 'round-robin' },
        },
      },
    },
    warnings,
  };
  plan.report = buildSafeReport(plan, entries.length);
  return plan;
}

function buildSafeReport(plan, sourceEntryCount = null) {
  const payload = plan.payload || {};
  return {
    schemaVersion: plan.schemaVersion,
    generatedAt: plan.generatedAt,
    source: plan.source,
    sourceHash: plan.sourceHash,
    dryRun: true,
    sourceEntryCount,
    importableConnectionCount: (payload.providerConnections || []).length,
    providerNodeCount: (payload.providerNodes || []).length,
    comboCount: (payload.combos || []).length,
    comboModels: (payload.combos || []).flatMap((combo) => combo.models || []),
    connections: (payload.providerConnections || []).map((connection) => ({
      id: connection.id,
      provider: connection.provider,
      name: connection.name,
      defaultModel: connection.defaultModel,
      isActive: connection.isActive,
      hasCredential: Boolean(connection.apiKey || connection.accessToken),
    })),
    warnings: plan.warnings || [],
  };
}

function ensurePrivateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(directory, 0o700); } catch { /* best effort */ }
}

function writePrivateJson(filePath, value) {
  const directory = path.dirname(filePath);
  ensurePrivateDirectory(directory);
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, filePath);
    try { fs.chmodSync(filePath, 0o600); } catch { /* best effort */ }
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch { /* best effort */ }
    throw error;
  }
  return filePath;
}

function saveMigrationPlan(plan, options = {}) {
  const dataDir = options.dataDir || resolveDataDir(options.env || process.env);
  const migrationDir = path.join(dataDir, 'migrations');
  return {
    planPath: writePrivateJson(path.join(migrationDir, PLAN_FILE), plan),
    reportPath: writePrivateJson(path.join(migrationDir, REPORT_FILE), plan.report || buildSafeReport(plan)),
  };
}

function mergeById(existing, incoming) {
  const result = Array.isArray(existing) ? existing.map((item) => ({ ...item })) : [];
  const positions = new Map(result.map((item, index) => [item.id, index]));
  for (const item of incoming || []) {
    if (positions.has(item.id)) result[positions.get(item.id)] = { ...result[positions.get(item.id)], ...item };
    else {
      positions.set(item.id, result.length);
      result.push({ ...item });
    }
  }
  return result;
}

function mergeCombos(existing, incoming) {
  const names = new Set((incoming || []).map((combo) => combo.name));
  return mergeById((existing || []).filter((combo) => !names.has(combo.name)), incoming || []);
}

function mergeImportPayload(existing, plan) {
  const base = existing && typeof existing === 'object' ? JSON.parse(JSON.stringify(existing)) : {};
  const patch = plan.payload || {};
  const settings = base.settings && typeof base.settings === 'object' ? base.settings : {};
  const existingStrategies = settings.comboStrategies && typeof settings.comboStrategies === 'object'
    ? settings.comboStrategies
    : {};
  const incomingSettings = patch.settingsPatch || {};
  base.settings = {
    ...settings,
    ...incomingSettings,
    comboStrategies: {
      ...existingStrategies,
      ...(incomingSettings.comboStrategies || {}),
    },
  };
  base.providerConnections = mergeById(base.providerConnections, patch.providerConnections);
  base.providerNodes = mergeById(base.providerNodes, patch.providerNodes);
  base.combos = mergeCombos(base.combos, patch.combos);
  for (const [key, fallback] of Object.entries({
    proxyPools: [],
    apiKeys: [],
    modelAliases: {},
    customModels: [],
    mitmAlias: {},
    pricing: {},
  })) {
    if (!hasOwn(base, key)) base[key] = fallback;
  }
  return base;
}

function ensureCliAuthFiles(dataDir) {
  ensurePrivateDirectory(dataDir);
  const authDir = path.join(dataDir, 'auth');
  ensurePrivateDirectory(authDir);
  const machineIdPath = path.join(dataDir, 'machine-id');
  const cliSecretPath = path.join(authDir, 'cli-secret');
  if (!fs.existsSync(machineIdPath)) {
    fs.writeFileSync(machineIdPath, `${crypto.randomUUID()}\n`, { mode: 0o600, flag: 'wx' });
  }
  if (!fs.existsSync(cliSecretPath)) {
    fs.writeFileSync(cliSecretPath, `${crypto.randomBytes(32).toString('hex')}\n`, { mode: 0o600, flag: 'wx' });
  }
  try { fs.chmodSync(machineIdPath, 0o600); } catch { /* best effort */ }
  try { fs.chmodSync(cliSecretPath, 0o600); } catch { /* best effort */ }
  return deriveCliToken(dataDir);
}

async function databaseRequest(baseUrl, cliToken, method, payload) {
  const response = await fetch(`${baseUrl}/api/settings/database`, {
    method,
    headers: {
      'x-9r-cli-token': cliToken,
      ...(payload ? { 'content-type': 'application/json' } : {}),
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  if (!response.ok) throw new Error(`unified database ${method} failed with HTTP ${response.status}`);
  return response.json();
}

async function applyMigrationPlan(plan, options = {}) {
  if (!plan || plan.schemaVersion !== MIGRATION_SCHEMA_VERSION) throw new Error(`Unsupported migration plan schema: ${plan?.schemaVersion}`);
  const dataDir = options.dataDir || resolveDataDir(options.env || process.env);
  ensurePrivateDirectory(dataDir);
  const cliToken = ensureCliAuthFiles(dataDir);
  const host = DEFAULT_HOST;
  const port = options.port || await reservePort(host);
  const child = spawnUnified({
    env: options.env || process.env,
    dataDir,
    host,
    port,
    stdio: options.stdio || ['ignore', 'ignore', 'inherit'],
  });
  try {
    const baseUrl = `http://${host}:${port}`;
    await waitForHealth(`${baseUrl}/api/health`, child, options.timeoutMs || 30000);
    const existing = await databaseRequest(baseUrl, cliToken, 'GET');
    const backupDir = path.join(dataDir, 'migrations', 'backups');
    const backupName = `pre-proxy-max-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const backupPath = writePrivateJson(path.join(backupDir, backupName), existing);
    const merged = mergeImportPayload(existing, plan);
    await databaseRequest(baseUrl, cliToken, 'POST', merged);
    const confirmed = await databaseRequest(baseUrl, cliToken, 'GET');
    const expectedIds = new Set((plan.payload.providerConnections || []).map((item) => item.id));
    const actualIds = new Set((confirmed.providerConnections || []).map((item) => item.id));
    for (const id of expectedIds) {
      if (!actualIds.has(id)) throw new Error('unified import verification failed: a planned connection is missing.');
    }
    return {
      ok: true,
      backupPath,
      importedConnections: expectedIds.size,
      importedNodes: (plan.payload.providerNodes || []).length,
      importedCombos: (plan.payload.combos || []).length,
      sourceHash: plan.sourceHash,
    };
  } finally {
    if (child.exitCode === null && !child.signalCode) child.kill('SIGTERM');
    await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode) return resolve();
      const timer = setTimeout(() => {
        if (child.exitCode === null && !child.signalCode) child.kill('SIGKILL');
        resolve();
      }, 3000);
      timer.unref();
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
}

module.exports = {
  MIGRATION_SCHEMA_VERSION,
  PLAN_FILE,
  REPORT_FILE,
  stableJson,
  digest,
  readLegacyConfig,
  allLegacyEntries,
  parseAzureDeployment,
  buildMigrationPlan,
  buildSafeReport,
  writePrivateJson,
  saveMigrationPlan,
  mergeImportPayload,
  deriveCliToken,
  ensureCliAuthFiles,
  applyMigrationPlan,
};
