// Re-export from open-sse with localDb integration
import { getModelAliases, getComboByName, getProviderNodes } from "@/lib/localDb";
import { parseModel as parseModelCore, resolveModelAliasFromMap, getModelInfoCore } from "open-sse/services/model.js";
import REGISTRY from "open-sse/providers/registry/index.js";
import { getNvidiaClaudeRouteModels, selectNvidiaClaudeRouteModels } from "@/lib/nvidiaCatalog";

// Local provider alias overrides (HMR-friendly, applied on top of open-sse map)
const LOCAL_PROVIDER_ALIASES = {
  xmtp: "xiaomi-tokenplan",
  "xiaomi-tokenplan": "xiaomi-tokenplan",
};

const RESERVED_PROVIDER_PREFIXES = new Set(Object.keys(LOCAL_PROVIDER_ALIASES));
for (const entry of REGISTRY) {
  RESERVED_PROVIDER_PREFIXES.add(entry.id);
  if (entry.alias) RESERVED_PROVIDER_PREFIXES.add(entry.alias);
  for (const alias of entry.aliases || []) RESERVED_PROVIDER_PREFIXES.add(alias);
}

export function parseModel(modelStr) {
  if (typeof modelStr !== "string" || !modelStr.trim()) {
    return { provider: null, model: null, isAlias: false, providerAlias: null };
  }

  const parsed = parseModelCore(modelStr.trim());
  if (parsed?.providerAlias && LOCAL_PROVIDER_ALIASES[parsed.providerAlias]) {
    return { ...parsed, provider: LOCAL_PROVIDER_ALIASES[parsed.providerAlias] };
  }
  return parsed;
}

const PROVIDER_NODE_TYPES = [
  "openai-compatible",
  "anthropic-compatible",
  "custom-embedding",
];

// Claude Code may append a context-window selector to its wire model id, for
// example `claude-opus-4-8[1m]`. That selector is client metadata, not part of
// a Proxy Max alias or an upstream provider model id.
export function normalizeClientModelName(modelStr) {
  if (typeof modelStr !== "string") return modelStr;
  const normalized = modelStr.trim();
  if (!normalized || normalized.includes("/")) return normalized;
  return normalized.replace(/\[(?:\d+(?:\.\d+)?[km]?|long)\]$/i, "");
}

async function resolveProviderNodePrefix(providerAlias, model) {
  if (
    typeof providerAlias !== "string" ||
    !providerAlias ||
    RESERVED_PROVIDER_PREFIXES.has(providerAlias)
  ) {
    return null;
  }

  // Preserve the historical type precedence while loading the node table only
  // once. Duplicate prefixes within a type remain an API validation concern.
  const nodes = await getProviderNodes();
  for (const type of PROVIDER_NODE_TYPES) {
    const matched = nodes.find((node) => node.type === type && node.prefix === providerAlias);
    if (matched) return { provider: matched.id, model };
  }
  return null;
}

/**
 * Resolve model alias from localDb
 */
export async function resolveModelAlias(alias) {
  const aliases = await getModelAliases();
  return resolveModelAliasFromMap(normalizeClientModelName(alias), aliases);
}

/**
 * Get full model info (parse or resolve)
 */
export async function getModelInfo(modelStr) {
  const parsed = parseModel(normalizeClientModelName(modelStr));

  if (!parsed.isAlias) {
    if (!parsed.provider || !parsed.model) {
      return { provider: null, model: null };
    }

    // Provider-node prefixes are user-defined. They must not override built-in
    // provider ids/aliases such as `cf`, `cloudflare-ai`, `openai`, or `hf`.
    const providerNode = await resolveProviderNodePrefix(parsed.providerAlias, parsed.model);
    if (providerNode) return providerNode;

    return {
      provider: parsed.provider,
      model: parsed.model
    };
  }

  // Check if this is a combo name before resolving as alias
  // This prevents combo names from being incorrectly routed to providers
  const combo = await getComboByName(parsed.model);
  if (combo) {
    // Return null provider to signal this should be handled as combo
    // The caller (handleChat) will detect this and handle it as combo
    return { provider: null, model: parsed.model };
  }

  const aliases = await getModelAliases();
  const resolvedAlias = resolveModelAliasFromMap(parsed.model, aliases);
  if (resolvedAlias) {
    // User aliases may target a compatible node's public prefix. The core
    // resolver knows registry aliases only, so resolve dynamic node prefixes
    // here exactly as we do for direct `prefix/model` requests.
    const providerNode = await resolveProviderNodePrefix(
      resolvedAlias.provider,
      resolvedAlias.model
    );
    return providerNode || resolvedAlias;
  }

  return getModelInfoCore(parsed.model, aliases);
}

/**
 * Check if model is a combo and get models list
 * @returns {Promise<string[]|null>} Array of models or null if not a combo
 */
export async function getComboModels(modelStr) {
  if (typeof modelStr !== "string" || !modelStr.trim()) return null;
  let normalized = normalizeClientModelName(modelStr);

  // Only check if it's not in provider/model format
  if (normalized.includes("/")) return null;

  // Client-facing aliases may target a server-side combo. This lets clients
  // stay model-agnostic while Proxy Max owns fallback and round-robin routing.
  const aliases = await getModelAliases();
  const aliasTarget = aliases?.[normalized];
  if (typeof aliasTarget === "string" && aliasTarget && !aliasTarget.includes("/")) {
    normalized = aliasTarget;
  }

  const combo = await getComboByName(normalized);
  const persistedModels = Array.isArray(combo?.models) ? combo.models : [];

  if (normalized === "claude-auto") {
    try {
      const liveNvidiaModels = await getNvidiaClaudeRouteModels();
      const mergedModels = mergeClaudeAutoRouteModels(liveNvidiaModels, persistedModels);
      if (mergedModels.length > 0) return mergedModels;
    } catch {
      // Sanitize the persisted NVIDIA entries even when catalog refresh is
      // offline, while preserving every cross-provider fallback.
      const mergedModels = mergeClaudeAutoRouteModels([], persistedModels);
      if (mergedModels.length > 0) return mergedModels;
    }
  }

  if (persistedModels.length > 0) return persistedModels;
  return null;
}

/**
 * Refresh NVIDIA's primary model without discarding the user's persisted
 * cross-provider fallbacks. Before this merge, merely adding an NVIDIA key
 * replaced the whole claude-auto combo with an NVIDIA-only route.
 */
export function mergeClaudeAutoRouteModels(liveNvidiaModels, persistedModels) {
  const live = Array.isArray(liveNvidiaModels) ? liveNvidiaModels : [];
  const persisted = Array.isArray(persistedModels) ? persistedModels : [];
  const nonNvidiaFallbacks = persisted.filter((model) => (
    typeof model === "string" && !model.trim().toLowerCase().startsWith("nvidia/")
  ));
  const persistedNvidiaModels = persisted
    .filter((model) => typeof model === "string" && model.trim().toLowerCase().startsWith("nvidia/"))
    .map((model) => model.trim().slice("nvidia/".length));
  const nvidiaPrimary = live.length > 0
    ? live
    : selectNvidiaClaudeRouteModels(persistedNvidiaModels).map((model) => `nvidia/${model}`);
  return [...new Set([...nvidiaPrimary, ...nonNvidiaFallbacks])];
}
