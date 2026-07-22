// Public API barrel — all DB functions
import { getAdapter } from "./driver.js";
import { stringifyJson, parseJson } from "./helpers/jsonCol.js";
import { decryptString, encryptString, hashSecret } from "./helpers/secureStorage.js";

// Settings
export {
  getSettings, updateSettings, isCloudEnabled, getCloudUrl, exportSettings,
} from "./repos/settingsRepo.js";

// Provider connections
export {
  getProviderConnections, getProviderConnectionById,
  createProviderConnection, updateProviderConnection,
  deleteProviderConnection, deleteProviderConnectionsByProvider,
  reorderProviderConnections, cleanupProviderConnections,
} from "./repos/connectionsRepo.js";

// Provider nodes
export {
  getProviderNodes, getProviderNodeById,
  createProviderNode, updateProviderNode, deleteProviderNode,
} from "./repos/nodesRepo.js";

// Proxy pools
export {
  getProxyPools, getProxyPoolById,
  createProxyPool, updateProxyPool, deleteProxyPool,
} from "./repos/proxyPoolsRepo.js";

// API keys
export {
  getApiKeys, getApiKeyById, createApiKey, updateApiKey, deleteApiKey, validateApiKey,
} from "./repos/apiKeysRepo.js";

// Combos
export {
  getCombos, getComboById, getComboByName,
  createCombo, updateCombo, deleteCombo,
} from "./repos/combosRepo.js";

// Aliases (model + custom + mitm)
export {
  getModelAliases, setModelAlias, deleteModelAlias,
  getCustomModels, addCustomModel, deleteCustomModel,
  getMitmAlias, setMitmAliasAll,
} from "./repos/aliasRepo.js";

// Pricing
export {
  getPricing, getPricingForModel, updatePricing, resetPricing, resetAllPricing,
} from "./repos/pricingRepo.js";

// Disabled models
export {
  getDisabledModels, getDisabledByProvider, disableModels, enableModels,
} from "./repos/disabledModelsRepo.js";

// Usage
export {
  statsEmitter, trackPendingRequest, getActiveRequests,
  saveRequestUsage, getUsageHistory, getUsageStats, getChartData,
  appendRequestLog, getRecentLogs,
} from "./repos/usageRepo.js";

// Request details
export {
  saveRequestDetail, getRequestDetails, getRequestDetailById, getDistinctProviders,
} from "./repos/requestDetailsRepo.js";

// Export/import full DB
export async function exportDb() {
  const db = await getAdapter();
  const { exportSettings } = await import("./repos/settingsRepo.js");

  const out = {
    databaseFormatVersion: 3,
    settings: await exportSettings(),
    providerConnections: db.all(`SELECT * FROM providerConnections`).map((r) => ({ ...parseJson(r.data, {}), id: r.id, provider: r.provider, authType: r.authType, name: r.name, email: r.email, priority: r.priority, isActive: r.isActive === 1, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    providerNodes: db.all(`SELECT * FROM providerNodes`).map((r) => ({ ...parseJson(r.data, {}), id: r.id, type: r.type, name: r.name, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    proxyPools: db.all(`SELECT * FROM proxyPools`).map((r) => ({ ...parseJson(r.data, {}), id: r.id, isActive: r.isActive === 1, testStatus: r.testStatus, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    apiKeys: db.all(`SELECT * FROM apiKeys`).map((r) => ({ id: r.id, key: decryptString(r.key), name: r.name, machineId: r.machineId, isActive: r.isActive === 1, createdAt: r.createdAt })),
    combos: db.all(`SELECT * FROM combos`).map((r) => ({ id: r.id, name: r.name, kind: r.kind, models: parseJson(r.models, []), createdAt: r.createdAt, updatedAt: r.updatedAt })),
    modelAliases: {},
    customModels: [],
    mitmAlias: {},
    pricing: {},
    disabledModels: {},
    kv: db.all(`SELECT scope, key, value FROM kv ORDER BY scope, key`).map((r) => ({ ...r, value: decryptString(r.value) })),
    usageHistory: db.all(`SELECT * FROM usageHistory ORDER BY id ASC`).map((r) => ({
      ...r,
      tokens: parseJson(r.tokens, {}),
      meta: parseJson(r.meta, {}),
    })),
    usageDaily: db.all(`SELECT dateKey, data FROM usageDaily ORDER BY dateKey ASC`).map((r) => ({
      dateKey: r.dateKey,
      data: parseJson(r.data, {}),
    })),
    requestDetails: db.all(`SELECT * FROM requestDetails ORDER BY timestamp ASC`).map((r) => ({
      ...parseJson(r.data, {}),
      id: r.id,
      timestamp: r.timestamp,
      provider: r.provider,
      model: r.model,
      connectionId: r.connectionId,
      status: r.status,
    })),
    meta: db.all(`SELECT key, value FROM _meta ORDER BY key ASC`),
  };

  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'modelAliases'`)) out.modelAliases[r.key] = parseJson(r.value);
  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'customModels'`)) out.customModels.push(parseJson(r.value));
  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'mitmAlias'`)) out.mitmAlias[r.key] = parseJson(r.value);
  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'pricing'`)) out.pricing[r.key] = parseJson(r.value);
  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'disabledModels'`)) out.disabledModels[r.key] = parseJson(r.value, []);

  return out;
}

export async function importDb(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid database payload");
  }
  const db = await getAdapter();
  const hasKvSnapshot = Array.isArray(payload.kv);
  const hasUsageHistory = Array.isArray(payload.usageHistory);
  const hasUsageDaily = Array.isArray(payload.usageDaily);
  const hasRequestDetails = Array.isArray(payload.requestDetails);
  const hasMetaSnapshot = Array.isArray(payload.meta);

  db.transaction(() => {
    // Wipe all tables (keep _meta)
    db.run(`DELETE FROM settings`);
    db.run(`DELETE FROM providerConnections`);
    db.run(`DELETE FROM providerNodes`);
    db.run(`DELETE FROM proxyPools`);
    db.run(`DELETE FROM apiKeys`);
    db.run(`DELETE FROM combos`);
    if (hasKvSnapshot) db.run(`DELETE FROM kv`);
    else db.run(`DELETE FROM kv WHERE scope IN ('modelAliases', 'customModels', 'mitmAlias', 'pricing', 'disabledModels')`);
    if (hasUsageHistory) db.run(`DELETE FROM usageHistory`);
    if (hasUsageDaily) db.run(`DELETE FROM usageDaily`);
    if (hasRequestDetails) db.run(`DELETE FROM requestDetails`);

    // Settings
    if (payload.settings) {
      db.run(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, [stringifyJson(payload.settings)]);
    }

    for (const c of payload.providerConnections || []) {
      const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = c;
      db.run(
        `INSERT OR REPLACE INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, provider, authType || "oauth", name || null, email || null, priority || null, isActive === false ? 0 : 1, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const n of payload.providerNodes || []) {
      const { id, type, name, createdAt, updatedAt, ...rest } = n;
      db.run(
        `INSERT OR REPLACE INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [id, type || null, name || null, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const p of payload.proxyPools || []) {
      const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
      db.run(
        `INSERT OR REPLACE INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [id, isActive === false ? 0 : 1, testStatus || "unknown", stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const k of payload.apiKeys || []) {
      if (!k || typeof k.key !== "string" || !k.key) continue;
      db.run(
        `INSERT OR REPLACE INTO apiKeys(id, key, keyHash, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?)`,
        [k.id, encryptString(k.key), hashSecret(k.key), k.name || null, k.machineId || null, k.isActive === false ? 0 : 1, k.createdAt || new Date().toISOString()]
      );
    }
    for (const c of payload.combos || []) {
      db.run(
        `INSERT OR REPLACE INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [c.id, c.name, c.kind || null, stringifyJson(c.models || []), c.createdAt || new Date().toISOString(), c.updatedAt || new Date().toISOString()]
      );
    }
    if (hasKvSnapshot) {
      for (const row of payload.kv) {
        if (!row || typeof row.scope !== "string" || typeof row.key !== "string" || typeof row.value !== "string") continue;
        db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES(?, ?, ?)`, [row.scope, row.key, encryptString(row.value)]);
      }
    }
    for (const [a, m] of Object.entries(payload.modelAliases || {})) {
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('modelAliases', ?, ?)`, [a, stringifyJson(m)]);
    }
    for (const m of payload.customModels || []) {
      const k = `${m.providerAlias}|${m.id}|${m.type || "llm"}`;
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('customModels', ?, ?)`, [k, stringifyJson(m)]);
    }
    for (const [tool, mappings] of Object.entries(payload.mitmAlias || {})) {
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('mitmAlias', ?, ?)`, [tool, stringifyJson(mappings || {})]);
    }
    for (const [provider, models] of Object.entries(payload.pricing || {})) {
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('pricing', ?, ?)`, [provider, stringifyJson(models || {})]);
    }
    for (const [provider, ids] of Object.entries(payload.disabledModels || {})) {
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('disabledModels', ?, ?)`, [provider, stringifyJson(ids || [])]);
    }

    if (hasUsageHistory) {
      for (const row of payload.usageHistory) {
        if (!row || !row.timestamp) continue;
        db.run(
          `INSERT INTO usageHistory(id, timestamp, provider, model, connectionId, apiKey, endpoint, requestId, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            row.id || null, row.timestamp, row.provider || null, row.model || null,
            row.connectionId || null, row.apiKey || null, row.endpoint || null,
            row.requestId || null, Number(row.promptTokens || 0), Number(row.completionTokens || 0),
            Number(row.cost || 0), row.status || "ok", stringifyJson(row.tokens || {}), stringifyJson(row.meta || {}),
          ]
        );
      }
    }
    if (hasUsageDaily) {
      for (const row of payload.usageDaily) {
        if (!row || typeof row.dateKey !== "string") continue;
        db.run(`INSERT OR REPLACE INTO usageDaily(dateKey, data) VALUES(?, ?)`, [row.dateKey, stringifyJson(row.data || {})]);
      }
    }
    if (hasRequestDetails) {
      for (const row of payload.requestDetails) {
        if (!row || !row.id) continue;
        const timestamp = row.timestamp || new Date().toISOString();
        db.run(
          `INSERT OR REPLACE INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?)`,
          [row.id, timestamp, row.provider || null, row.model || null, row.connectionId || null, row.status || null, stringifyJson(row)]
        );
      }
    }
    if (hasMetaSnapshot) {
      const protectedMeta = new Set(["schemaVersion", "backupSchemaVersion", "appVersion"]);
      for (const row of payload.meta) {
        if (!row || typeof row.key !== "string" || protectedMeta.has(row.key)) continue;
        db.run(`INSERT INTO _meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [row.key, String(row.value ?? "")]);
      }
    }
  });

  db.checkpoint?.();

  return await exportDb();
}

// Eager init helper (optional)
export async function initDb() {
  await getAdapter();
}
