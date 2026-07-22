import { getProviderConnections } from "@/lib/localDb";

const NVIDIA_MODELS_URL = "https://integrate.api.nvidia.com/v1/models";
const CATALOG_TTL_MS = 5 * 60 * 1000;
// Keep NVIDIA to one primary inside claude-auto. The persisted combo supplies
// cross-provider fallbacks; fanning a single Claude turn across several NIM
// models (and every API key) amplifies NVIDIA worker-pool exhaustion.
const CLAUDE_AUTO_MODEL_LIMIT = 1;
const catalogCache = new Map();

// NVIDIA's catalog contains many retired, single-tool-only, short-context,
// and narrowly specialized chat models. They may appear in /v1/models while
// still failing a Claude Code tool loop. Keep automatic routing deliberately
// small and promote only models that are intended for large agentic contexts.
const CLAUDE_AUTO_MODEL_PATTERNS = [
  /^deepseek-ai\/deepseek-v4-flash$/,
  /^deepseek-ai\/deepseek-v4-pro$/,
  /^qwen\/qwen3-coder-480b-a35b-instruct$/,
  /^qwen\/qwen3\.5-397b-a17b$/,
  /^minimaxai\/minimax-m3$/,
  /^openai\/gpt-oss-120b$/,
  /^nvidia\/nemotron-3-ultra-550b-a55b$/,
  /^mistralai\/mistral-large-3-675b-instruct-2512$/,
  /^mistralai\/mistral-small-4-119b-2603$/,
  /^meta\/llama-4-maverick-17b-128e-instruct$/,
];

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

export function isNvidiaClaudeAutoModelId(modelId) {
  const id = String(modelId || "").trim().toLowerCase();
  return isNvidiaClaudeToolModelId(id)
    && CLAUDE_AUTO_MODEL_PATTERNS.some((pattern) => pattern.test(id));
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

export function selectNvidiaClaudeRouteModels(models) {
  if (!Array.isArray(models)) return [];
  const rank = (model) => {
    const id = model.toLowerCase();
    return CLAUDE_AUTO_MODEL_PATTERNS.findIndex((pattern) => pattern.test(id));
  };

  return models
    .filter(isNvidiaClaudeAutoModelId)
    .map((model, index) => ({ model, index, rank: rank(model) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, CLAUDE_AUTO_MODEL_LIMIT)
    .map(({ model }) => model);
}

export async function getNvidiaClaudeRouteModels() {
  const models = await getNvidiaCatalogModels();
  return selectNvidiaClaudeRouteModels(models).map((model) => `nvidia/${model}`);
}

export function clearNvidiaCatalogCache() {
  catalogCache.clear();
}
