import { getProviderConnections } from "@/lib/localDb";

const NVIDIA_MODELS_URL = "https://integrate.api.nvidia.com/v1/models";
const CATALOG_TTL_MS = 5 * 60 * 1000;
const catalogCache = new Map();

function connectionCacheKey(connection) {
  return `${connection?.id || "nvidia"}:${connection?.updatedAt || ""}`;
}

export function isNvidiaChatModelId(modelId) {
  const id = String(modelId || "").trim().toLowerCase();
  if (!id) return false;

  // These catalog entries use dedicated media/embedding/moderation endpoints
  // or produce non-conversational outputs, so they must stay visible in their
  // own model lists but never receive a Claude Code tools request.
  return !(
    /embed|retriev|nvclip|reward|guard|safety|detector|gliner|(?:^|[-_/])pii(?:$|[-_/])/.test(id)
    || /(?:^|\/)(?:deplot|nemotron-parse|nemoretriever-parse)(?:$|[-_/])/.test(id)
    || /diffusion/.test(id)
  );
}

// The NVIDIA catalog also exposes research, calibration, base, and narrowly
// specialized models through the chat-compatible endpoint. They stay visible
// under NVIDIA Available Models, but Claude Code auto-routing must only select
// models whose ids indicate instruction following, reasoning, or coding. A
// transport-level 200 from a calibration model is not evidence of valid tool
// use.
export function isNvidiaClaudeToolModelId(modelId) {
  const id = String(modelId || "").trim().toLowerCase();
  if (!isNvidiaChatModelId(id)) return false;
  // Nemotron Super accepts tool schemas but has repeatedly emitted unbounded
  // planning prose instead of a tool call under Claude Code. Keep it in the
  // NVIDIA catalog, but never select it automatically for an agentic route.
  if (id === "nvidia/nemotron-3-super-120b-a12b") return false;
  if (/calibrat|(?:^|[-_/])base(?:$|[-_/])|pretrain|reward|rerank|translate|transcrib/.test(id)) {
    return false;
  }
  return /(?:instruct|chat|coder|codestral|starcoder|codegemma|reason|nemotron|gpt-oss|deepseek|qwen|llama|mistral|mixtral|glm|mini?max|kimi|step[-_.]|command-r|granite|phi[-_.]|gemma)/.test(id);
}

export async function getNvidiaCatalogModels(connectionOverride = null) {
  let connection = connectionOverride;
  if (!connection) {
    const connections = await getProviderConnections();
    connection = connections.find((item) => item.provider === "nvidia" && item.isActive !== false);
  }
  if (!connection?.apiKey) return [];

  const key = connectionCacheKey(connection);
  const cached = catalogCache.get(key);
  if (cached?.models && cached.expiresAt > Date.now()) return cached.models;
  if (cached?.promise) return cached.promise;

  const promise = (async () => {
    const response = await fetch(NVIDIA_MODELS_URL, {
      headers: { Authorization: `Bearer ${connection.apiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`NVIDIA catalog HTTP ${response.status}`);
    const payload = await response.json();
    const candidates = Array.isArray(payload?.data)
      ? payload.data
      : (Array.isArray(payload?.models) ? payload.models : []);
    const models = [...new Set(
      candidates
        .map((model) => model?.id || model?.name)
        .filter((id) => typeof id === "string" && id.trim())
        .map((id) => id.trim()),
    )];
    catalogCache.set(key, { models, expiresAt: Date.now() + CATALOG_TTL_MS });
    return models;
  })();

  catalogCache.set(key, { promise, expiresAt: Date.now() + CATALOG_TTL_MS });
  try {
    return await promise;
  } catch (error) {
    catalogCache.delete(key);
    throw error;
  }
}

export async function getNvidiaClaudeRouteModels() {
  const models = await getNvidiaCatalogModels();
  const priorityPatterns = [
    /qwen\/qwen3-coder-480b-a35b-instruct/,
    /nemotron-3-super-120b-a12b/,
    /deepseek-v4-flash/,
    /gpt-oss-120b/,
    /qwen3\.5/,
    /nemotron-3-ultra/,
    /mistral-(?:large-3|small-4)/,
    /llama-4-maverick/,
    /step-3\.7-flash/,
    /minimax-m3/,
    /deepseek-v4-pro/,
    /kimi-k2\.6/,
    /glm-5\.2/,
    /(?:coder|codestral|starcoder|codegemma)/,
    /(?:reason|instruct|chat)/,
  ];
  const rank = (model) => {
    const id = model.toLowerCase();
    const index = priorityPatterns.findIndex((pattern) => pattern.test(id));
    return index === -1 ? priorityPatterns.length : index;
  };

  return models
    .filter(isNvidiaClaudeToolModelId)
    .map((model, index) => ({ model, index, rank: rank(model) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ model }) => `nvidia/${model}`);
}

export function clearNvidiaCatalogCache() {
  catalogCache.clear();
}
