import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import {
  getProviderConnections,
  updateProviderConnection,
} from "./connectionsRepo.js";
import REGISTRY from "open-sse/providers/registry/index.js";
import { resolveProviderAlias } from "open-sse/services/model.js";

const DISABLED_MODELS_SCOPE = "disabledModels";

function splitModelRoute(modelStr) {
  const value = String(modelStr || "").trim();
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) return null;
  return {
    prefix: value.slice(0, slash),
    model: value.slice(slash + 1),
  };
}

function providerPrefixes(provider, routePrefix) {
  const canonical = resolveProviderAlias(provider || routePrefix);
  const registry = REGISTRY.find((entry) => entry.id === canonical);
  return [...new Set([
    routePrefix,
    canonical,
    registry?.alias,
    ...(registry?.aliases || []),
  ].filter(Boolean))];
}

/**
 * Persist a routing quarantine so the portal and every future combo request
 * agree with the in-memory circuit breaker.
 *
 * Provider scope deactivates all configured credentials and removes every
 * route for that provider. Model scope removes only the failed model. Both
 * scopes write disabled-model entries so generated combos cannot add the route
 * back until a user explicitly enables it again.
 */
export async function quarantineRoutingTarget({
  provider,
  modelStr,
  scope = "model",
  status = null,
  reason = "Automatically disabled after an upstream routing failure",
  retryAt = null,
} = {}) {
  const route = splitModelRoute(modelStr);
  if (!route) return { changed: false, reason: "invalid_model_route" };

  const canonicalProvider = resolveProviderAlias(provider || route.prefix);
  const prefixes = providerPrefixes(canonicalProvider, route.prefix);
  const prefixSet = new Set(prefixes.map((value) => String(value).toLowerCase()));
  const providerWide = scope === "provider";
  const matches = (candidate) => {
    const parsed = splitModelRoute(candidate);
    if (!parsed || resolveProviderAlias(parsed.prefix) !== canonicalProvider) return false;
    return providerWide || parsed.model === route.model;
  };

  const db = await getAdapter();
  const changedCombos = [];
  const removedRoutes = new Set([modelStr]);
  let disabledModelEntries = 0;
  db.transaction(() => {
    const combos = db.all(`SELECT * FROM combos ORDER BY createdAt ASC`);
    for (const combo of combos) {
      const current = parseJson(combo.models, []) || [];
      const removed = current.filter(matches);
      if (removed.length === 0) continue;
      removed.forEach((value) => removedRoutes.add(value));
      const next = current.filter((value) => !matches(value));
      const updatedAt = new Date().toISOString();
      db.run(`UPDATE combos SET models = ?, updatedAt = ? WHERE id = ?`, [
        stringifyJson(next),
        updatedAt,
        combo.id,
      ]);
      changedCombos.push({ id: combo.id, name: combo.name, removed, models: next });
    }

    const modelIds = [...new Set(
      [...removedRoutes]
        .map(splitModelRoute)
        .filter((value) => value && (
          prefixSet.has(value.prefix.toLowerCase())
          || resolveProviderAlias(value.prefix) === canonicalProvider
        ))
        .map((value) => value.model),
    )];
    for (const prefix of prefixes) {
      const row = db.get(`SELECT value FROM kv WHERE scope = ? AND key = ?`, [
        DISABLED_MODELS_SCOPE,
        prefix,
      ]);
      const current = row ? (parseJson(row.value, []) || []) : [];
      const merged = [...new Set([...current, ...modelIds])];
      disabledModelEntries += merged.length - current.length;
      db.run(
        `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
        [DISABLED_MODELS_SCOPE, prefix, stringifyJson(merged)],
      );
    }
  });

  let disabledConnections = 0;
  if (providerWide) {
    const connections = await getProviderConnections({ provider: canonicalProvider });
    const now = new Date().toISOString();
    await Promise.all(connections.map(async (connection) => {
      await updateProviderConnection(connection.id, {
        isActive: false,
        testStatus: "unavailable",
        lastError: String(reason).slice(0, 500),
        lastErrorAt: now,
        errorCode: status,
        rateLimitedUntil: retryAt || connection.rateLimitedUntil || null,
        automaticallyDisabledAt: now,
        automaticallyDisabledReason: String(reason).slice(0, 500),
      });
      disabledConnections += 1;
    }));
  }

  return {
    changed: changedCombos.length > 0
      || disabledConnections > 0
      || disabledModelEntries > 0,
    provider: canonicalProvider,
    scope: providerWide ? "provider" : "model",
    disabledConnections,
    disabledModelEntries,
    changedCombos,
    removedRoutes: [...removedRoutes],
  };
}
