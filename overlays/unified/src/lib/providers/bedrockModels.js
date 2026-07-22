import { signBedrockControlRequest } from "open-sse/executors/bedrock.js";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_PROFILE_PAGES = 20;
const cache = new Map();

function cacheKey(connection) {
  const data = connection?.providerSpecificData || {};
  return `${connection?.id || "bedrock"}:${connection?.updatedAt || ""}:${data.region || "us-east-1"}`;
}

function modelKind(summary) {
  const outputs = Array.isArray(summary?.outputModalities)
    ? summary.outputModalities.map((item) => String(item).toUpperCase())
    : [];
  if (outputs.includes("EMBEDDING")) return "embedding";
  if (outputs.includes("IMAGE")) return "image";
  return "llm";
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

async function signedGet(url, credentials, options) {
  const headers = signBedrockControlRequest({ url, ...credentials });
  const fetchFn = options.fetchFn || proxyAwareFetch;
  const response = await fetchFn(url, {
    method: "GET",
    headers,
    cache: "no-store",
    signal: options.signal || AbortSignal.timeout(5_000),
  }, options.proxyOptions || null);
  if (!response.ok) throw new Error(`AWS Bedrock catalog HTTP ${response.status}`);
  return response.json();
}

async function fetchInferenceProfiles(baseUrl, credentials, options) {
  const models = [];
  let nextToken = "";
  for (let page = 0; page < MAX_PROFILE_PAGES; page += 1) {
    const url = new URL(`${baseUrl}/inference-profiles`);
    url.searchParams.set("maxResults", "100");
    if (nextToken) url.searchParams.set("nextToken", nextToken);
    const payload = await signedGet(url.toString(), credentials, options);
    const summaries = Array.isArray(payload?.inferenceProfileSummaries)
      ? payload.inferenceProfileSummaries
      : [];
    for (const summary of summaries) {
      const id = summary?.inferenceProfileId || summary?.id;
      if (!id) continue;
      models.push({
        id,
        name: summary?.inferenceProfileName || summary?.name || id,
        kind: "llm",
        inferenceProfileType: summary?.type,
      });
    }
    nextToken = typeof payload?.nextToken === "string" ? payload.nextToken : "";
    if (!nextToken) break;
  }
  return models;
}

/** Return every foundation model and inference profile visible to this AWS
 * identity in its configured region. No inference request is made.
 */
export async function resolveBedrockModels(connection, options = {}) {
  const data = connection?.providerSpecificData || {};
  const region = String(data.region || "us-east-1").trim();
  const credentials = {
    accessKeyId: connection?.apiKey,
    secretAccessKey: data.secretAccessKey,
    sessionToken: data.sessionToken,
    region,
  };
  const configured = [data.model, data.deployment, connection?.defaultModel]
    .filter((id) => typeof id === "string" && id.trim())
    .map((id) => ({ id: id.trim(), name: id.trim(), kind: "llm" }));
  if (!credentials.accessKeyId || !credentials.secretAccessKey) return { models: configured };

  const key = cacheKey(connection);
  const cached = cache.get(key);
  if (!options.forceRefresh && cached?.models && cached.expiresAt > Date.now()) return cached;
  if (!options.forceRefresh && cached?.promise) return cached.promise;

  const promise = (async () => {
    const baseUrl = `https://bedrock.${region}.amazonaws.com`;
    const results = await Promise.allSettled([
      signedGet(`${baseUrl}/foundation-models`, credentials, options),
      fetchInferenceProfiles(baseUrl, credentials, options),
    ]);
    const foundationPayload = results[0].status === "fulfilled" ? results[0].value : null;
    const foundationModels = (foundationPayload?.modelSummaries || [])
      .filter((summary) => !summary?.modelLifecycle?.status || summary.modelLifecycle.status === "ACTIVE")
      .map((summary) => ({
        id: summary.modelId,
        name: summary.modelName || summary.modelId,
        kind: modelKind(summary),
        providerName: summary.providerName,
        inputModalities: summary.inputModalities,
        outputModalities: summary.outputModalities,
        inferenceTypesSupported: summary.inferenceTypesSupported,
      }));
    const profileModels = results[1].status === "fulfilled" ? results[1].value : [];
    const models = uniqueModels([...configured, ...foundationModels, ...profileModels]);
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length === results.length && models.length === 0) throw failures[0].reason;
    const value = {
      models,
      ...(failures.length ? { warning: "Some AWS Bedrock catalog endpoints were unavailable." } : {}),
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

export function clearBedrockModelsCache() {
  cache.clear();
}
