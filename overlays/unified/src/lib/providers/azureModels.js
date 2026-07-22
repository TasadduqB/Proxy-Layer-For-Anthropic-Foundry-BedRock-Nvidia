import { AzureExecutor } from "open-sse/executors/azure.js";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_PAGES = 20;
const cache = new Map();

function cacheKey(connection) {
  const data = connection?.providerSpecificData || {};
  return `${connection?.id || "azure"}:${connection?.updatedAt || ""}:${data.azureEndpoint || ""}`;
}

function uniqueModels(models) {
  const byId = new Map();
  for (const model of models) {
    const id = String(model?.id || "").trim();
    if (!id) continue;
    const previous = byId.get(id);
    byId.set(id, { ...previous, ...model, id, name: model?.name || previous?.name || id });
  }
  return [...byId.values()];
}

function inferKind(model) {
  const id = String(model?.id || model?.name || model?.model_name || "").toLowerCase();
  if (/embed/.test(id)) return "embedding";
  if (/image|imagen|dall-?e|flux|stable.diffusion/.test(id)) return "image";
  if (/speech|tts|audio/.test(id)) return "tts";
  return "llm";
}

function parseModelList(payload) {
  const list = Array.isArray(payload)
    ? payload
    : (payload?.data || payload?.value || payload?.models || payload?.results || []);
  if (!Array.isArray(list)) return [];
  return list.map((item) => {
    const id = item?.id || item?.model || item?.model_name || item?.modelName || item?.name;
    if (!id) return null;
    return { ...item, id, name: item?.display_name || item?.displayName || item?.name || id, kind: inferKind({ ...item, id }) };
  }).filter(Boolean);
}

function parseDeployments(payload) {
  const list = payload?.value || payload?.data || payload?.deployments || payload?.results || [];
  if (!Array.isArray(list)) return [];
  return list.map((item) => {
    const id = item?.name || item?.deploymentName || item?.id;
    if (!id) return null;
    const underlying = item?.model?.name || item?.modelName || item?.properties?.model?.name
      || item?.properties?.modelName || item?.properties?.model?.format;
    return {
      id,
      name: underlying && underlying !== id ? `${id} (${underlying})` : id,
      kind: inferKind({ id: underlying || id }),
      ...(underlying ? { upstreamModelName: underlying } : {}),
    };
  }).filter(Boolean);
}

function parseModelInfo(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const id = payload.model_name || payload.modelName || payload.model?.name || payload.id;
  return id ? [{ id, name: payload.model_display_name || payload.modelDisplayName || id, kind: inferKind({ id }) }] : [];
}

function catalogUrls(rawEndpoint) {
  const endpoint = new URL(rawEndpoint);
  endpoint.hash = "";
  endpoint.search = "";
  endpoint.pathname = endpoint.pathname.replace(/\/+$/, "");
  const endpointBase = endpoint.toString().replace(/\/+$/, "");
  const urls = [];
  if (/\/api\/projects\/[^/]+$/i.test(endpoint.pathname)) {
    urls.push({ url: `${endpointBase}/deployments?api-version=v1`, parser: parseDeployments, paged: true });
  }
  const root = new URL(endpoint.origin);
  urls.push(
    { url: `${root.origin}/openai/models?api-version=2024-10-21`, parser: parseModelList, paged: true },
    { url: `${root.origin}/openai/v1/models`, parser: parseModelList, paged: true },
    { url: `${endpointBase}/models/info?api-version=2024-05-01-preview`, parser: parseModelInfo, paged: false },
  );
  return urls;
}

async function fetchCatalogEntry(entry, headers, options) {
  const fetchFn = options.fetchFn || proxyAwareFetch;
  const models = [];
  let url = entry.url;
  const expectedHost = new URL(url).host;
  for (let page = 0; page < MAX_PAGES && url; page += 1) {
    const response = await fetchFn(url, {
      method: "GET",
      headers,
      cache: "no-store",
      signal: options.signal || AbortSignal.timeout(5_000),
    }, options.proxyOptions || null);
    if (!response.ok) throw new Error(`Azure AI Foundry catalog HTTP ${response.status}`);
    const payload = await response.json();
    models.push(...entry.parser(payload));
    const next = entry.paged ? (payload?.nextLink || payload?.next_link || payload?.next) : null;
    if (!next) break;
    const parsedNext = new URL(next, url);
    if (parsedNext.host !== expectedHost || parsedNext.protocol !== "https:") break;
    url = parsedNext.toString();
  }
  return models;
}

/** Discover Azure OpenAI account models, Foundry project deployments, and the
 * model behind a serverless/managed Foundry inference endpoint.
 */
export async function resolveAzureModels(connection, options = {}) {
  const data = connection?.providerSpecificData || {};
  const endpoint = typeof data.azureEndpoint === "string" ? data.azureEndpoint.trim() : "";
  const configured = [data.deployment, connection?.defaultModel]
    .filter((id) => typeof id === "string" && id.trim())
    .map((id) => ({ id: id.trim(), name: id.trim(), kind: "llm" }));
  if (!endpoint || (!connection?.apiKey && !connection?.accessToken)) return { models: configured };

  const key = cacheKey(connection);
  const cached = cache.get(key);
  if (!options.forceRefresh && cached?.models && cached.expiresAt > Date.now()) return cached;
  if (!options.forceRefresh && cached?.promise) return cached.promise;

  const promise = (async () => {
    const headers = new AzureExecutor().buildHeaders(connection, false);
    const entries = catalogUrls(endpoint);
    const results = await Promise.allSettled(entries.map((entry) => fetchCatalogEntry(entry, headers, options)));
    const discovered = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    const models = uniqueModels([...configured, ...discovered]);
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length === results.length && models.length === 0) throw failures[0].reason;
    const value = {
      models,
      ...(failures.length ? { warning: "Some Azure AI Foundry catalog endpoints were unavailable." } : {}),
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
    cache.set(key, value);
    return value;
  })();
  cache.set(key, { promise, expiresAt: Date.now() + CACHE_TTL_MS });
  try {
    return await promise;
  } catch (error) {
    cache.delete(key);
    throw error;
  }
}

export function clearAzureModelsCache() {
  cache.clear();
}
