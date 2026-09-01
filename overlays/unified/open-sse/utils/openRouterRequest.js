const CONTEXT_COMPRESSION_PLUGIN_ID = "context-compression";
const UNSUPPORTED_TOOL_SCHEMA_KEYS = new Set([
  "dependencies",
  "dependentRequired",
  "dependentSchemas",
  "propertyNames",
  "unevaluatedProperties",
  "unevaluatedItems",
]);

function stripUnsupportedSchemaKeywords(value) {
  if (!value || typeof value !== "object") return 0;
  let removed = 0;
  if (Array.isArray(value)) {
    for (const item of value) removed += stripUnsupportedSchemaKeywords(item);
    return removed;
  }
  for (const key of Object.keys(value)) {
    if (UNSUPPORTED_TOOL_SCHEMA_KEYS.has(key)) {
      delete value[key];
      removed += 1;
      continue;
    }
    removed += stripUnsupportedSchemaKeywords(value[key]);
  }
  return removed;
}

/**
 * OpenRouter can compact an oversized conversation before model selection.
 * Enable its native plugin by default while respecting an explicit caller
 * configuration (including enabled:false).
 */
export function enableOpenRouterContextCompression(provider, body) {
  if (provider !== "openrouter" || !body || typeof body !== "object") return false;
  if (body.plugins !== undefined && !Array.isArray(body.plugins)) return false;

  const plugins = Array.isArray(body.plugins) ? body.plugins : [];
  if (plugins.some((plugin) => plugin?.id === CONTEXT_COMPRESSION_PLUGIN_ID)) return false;

  body.plugins = [...plugins, { id: CONTEXT_COMPRESSION_PLUGIN_ID }];
  return true;
}

export function isDeterministicContextError(status, errorText) {
  if (Number(status) !== 400) return false;
  const text = typeof errorText === "string" ? errorText.toLowerCase() : "";
  return /context[_ -]length|context window|maximum context|requested about \d+ tokens|too many messages/.test(text);
}

/**
 * Request-shape failures are tied to the payload/model combination, not the
 * credential. They should trigger model fallback without cooling down a
 * healthy OpenRouter account.
 */
export function isDeterministicOpenRouterRequestError(status, errorText) {
  if (isDeterministicContextError(status, errorText)) return true;
  if (![400, 422].includes(Number(status))) return false;
  const text = typeof errorText === "string" ? errorText.toLowerCase() : "";
  return /tool schemas?|invalid.{0,40}tools|property-name|propertynames|unevaluated assertions?|unevaluatedproperties|dependentrequired|dependenc(?:y|ies)/.test(text);
}

export function normalizeOpenRouterToolSchemas(provider, body) {
  if (provider !== "openrouter" || !Array.isArray(body?.tools)) return 0;
  let removed = 0;
  for (const tool of body.tools) {
    const schema = tool?.function?.parameters || tool?.input_schema;
    removed += stripUnsupportedSchemaKeywords(schema);
  }
  return removed;
}

export { CONTEXT_COMPRESSION_PLUGIN_ID };
