import { DefaultExecutor } from "./default.js";

export const AZURE_API_TYPES = Object.freeze(["chat", "responses"]);
export const AZURE_ENDPOINT_MODES = Object.freeze(["deployment", "direct", "full"]);
export const AZURE_AUTH_MODES = Object.freeze(["api-key", "bearer", "both"]);

const DEFAULT_API_VERSION = "2024-10-01-preview";
const MAX_HEADER_VALUE_LENGTH = 16 * 1024;
const MAX_DEPLOYMENT_LENGTH = 512;
const MAX_ENDPOINT_LENGTH = 16 * 1024;
const MAX_API_VERSION_LENGTH = 256;

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function normalizeChoice(value, allowed, fallback, label, aliases = {}) {
  const raw = firstNonEmpty(value);
  if (!raw) return fallback;
  const normalized = aliases[raw.toLowerCase()] || raw.toLowerCase();
  if (!allowed.includes(normalized)) {
    throw new Error(`Azure ${label} is invalid`);
  }
  return normalized;
}

function normalizeApiType(value) {
  return normalizeChoice(value, AZURE_API_TYPES, "chat", "API type");
}

function normalizeEndpointMode(value) {
  return normalizeChoice(value, AZURE_ENDPOINT_MODES, "deployment", "endpoint mode");
}

function inferredAuthMode(credentials, configuredMode) {
  return normalizeChoice(
    configuredMode,
    AZURE_AUTH_MODES,
    credentials?.accessToken && !credentials?.apiKey ? "bearer" : "api-key",
    "authentication mode",
    {
      apikey: "api-key",
      api_key: "api-key",
      entra: "bearer",
      "entra-token": "bearer",
      token: "bearer",
    },
  );
}

function normalizeHeaderValue(value, label) {
  const normalized = firstNonEmpty(value);
  if (!normalized) return null;
  if (normalized.length > MAX_HEADER_VALUE_LENGTH || /[\r\n\0]/.test(normalized)) {
    throw new Error(`Azure ${label} is invalid`);
  }
  return normalized;
}

function normalizeDeployment(value) {
  const deployment = firstNonEmpty(value);
  if (!deployment) return null;
  if (deployment.length > MAX_DEPLOYMENT_LENGTH || /[\0-\x1f\x7f]/.test(deployment)) {
    throw new Error("Azure deployment is invalid");
  }
  return deployment;
}

function normalizeApiVersion(value) {
  const apiVersion = firstNonEmpty(value);
  if (!apiVersion) return null;
  if (apiVersion.length > MAX_API_VERSION_LENGTH || /[\0-\x1f\x7f]/.test(apiVersion)) {
    throw new Error("Azure API version is invalid");
  }
  return apiVersion;
}

function parseEndpoint(value) {
  const raw = firstNonEmpty(value);
  if (!raw) {
    throw new Error("Azure endpoint is required");
  }
  if (raw.length > MAX_ENDPOINT_LENGTH || /[\r\n\0]/.test(raw)) {
    throw new Error("Azure endpoint is invalid");
  }

  let endpoint;
  try {
    endpoint = new URL(raw);
  } catch {
    throw new Error("Azure endpoint must be an absolute http(s) URL");
  }
  if (endpoint.protocol !== "https:" && endpoint.protocol !== "http:") {
    throw new Error("Azure endpoint must use http or https");
  }
  if (endpoint.username || endpoint.password) {
    throw new Error("Azure endpoint cannot contain credentials");
  }
  if (raw.includes("#") || endpoint.hash) {
    throw new Error("Azure endpoint cannot contain a fragment");
  }

  const queryKeys = [...endpoint.searchParams.keys()];
  if (
    queryKeys.some((key) => key !== "api-version") ||
    endpoint.searchParams.getAll("api-version").length > 1 ||
    (queryKeys.includes("api-version") && !firstNonEmpty(endpoint.searchParams.get("api-version")))
  ) {
    throw new Error("Azure endpoint query may only contain api-version");
  }
  return endpoint;
}

function hasExpectedFullPath(pathname, apiType) {
  const normalized = pathname.replace(/\/+$/, "");
  return apiType === "responses"
    ? /\/responses$/i.test(normalized)
    : /\/chat\/completions$/i.test(normalized);
}

function appendPath(endpoint, suffix) {
  const basePath = endpoint.pathname.replace(/\/+$/, "");
  endpoint.pathname = `${basePath}${suffix}` || suffix;
}

/**
 * Normalize a persisted Azure connection into an explicit, stable schema.
 * Unknown provider-specific fields are intentionally not copied here; callers
 * may merge the result into the original object to preserve proxy settings.
 */
export function normalizeAzureProviderSpecificData(providerSpecificData = {}, options = {}) {
  const apiType = normalizeApiType(
    providerSpecificData.apiType ?? process.env.AZURE_API_TYPE,
  );
  const endpointMode = normalizeEndpointMode(
    providerSpecificData.endpointMode ?? process.env.AZURE_ENDPOINT_MODE,
  );
  const authMode = inferredAuthMode(options.credentials, providerSpecificData.authMode ?? process.env.AZURE_AUTH_MODE);
  const azureEndpoint = firstNonEmpty(
    providerSpecificData.azureEndpoint,
    process.env.AZURE_ENDPOINT,
  );
  if (!azureEndpoint) throw new Error("Azure endpoint is required");

  // Parse now so every persistence/validation/runtime caller enforces the same
  // absolute-URL, credentials, fragment, and query restrictions.
  const endpoint = parseEndpoint(azureEndpoint);
  const endpointApiVersion = firstNonEmpty(endpoint.searchParams.get("api-version"));
  const apiVersion = normalizeApiVersion(firstNonEmpty(
    endpointApiVersion,
    providerSpecificData.apiVersion,
    process.env.AZURE_API_VERSION,
    DEFAULT_API_VERSION,
  ));
  const deployment = normalizeDeployment(
    providerSpecificData.deployment ?? options.model ?? process.env.AZURE_DEPLOYMENT,
  );
  const organization = normalizeHeaderValue(
    providerSpecificData.organization ?? process.env.AZURE_ORGANIZATION,
    "organization",
  );

  if (options.requireDeployment !== false && endpointMode === "deployment" && apiType === "chat" && !deployment) {
    throw new Error("Azure deployment is required for deployment chat mode");
  }
  if (endpointMode === "full" && !hasExpectedFullPath(endpoint.pathname, apiType)) {
    throw new Error(`Azure full endpoint must end in ${apiType === "responses" ? "/responses" : "/chat/completions"}`);
  }

  return {
    apiType,
    endpointMode,
    authMode,
    azureEndpoint,
    ...(deployment ? { deployment } : {}),
    ...(apiVersion ? { apiVersion } : {}),
    ...(organization ? { organization } : {}),
  };
}

/** Build one of the supported Azure/Foundry inference endpoint shapes. */
export function buildAzureEndpoint(model, credentials = {}) {
  const providerSpecificData = normalizeAzureProviderSpecificData(
    credentials.providerSpecificData || {},
    { credentials, model },
  );
  const endpoint = parseEndpoint(providerSpecificData.azureEndpoint);
  const endpointVersion = firstNonEmpty(endpoint.searchParams.get("api-version"));
  endpoint.search = "";

  if (providerSpecificData.endpointMode === "deployment") {
    if (providerSpecificData.apiType === "responses") {
      appendPath(endpoint, "/openai/responses");
    } else {
      appendPath(
        endpoint,
        `/openai/deployments/${encodeURIComponent(providerSpecificData.deployment)}/chat/completions`,
      );
    }
  } else if (providerSpecificData.endpointMode === "direct") {
    appendPath(endpoint, providerSpecificData.apiType === "responses" ? "/responses" : "/chat/completions");
  } else if (!hasExpectedFullPath(endpoint.pathname, providerSpecificData.apiType)) {
    // Defensive re-check in case this helper is called without normalization.
    throw new Error("Azure full endpoint path is invalid");
  }

  const apiVersion = endpointVersion || providerSpecificData.apiVersion;
  if (apiVersion) endpoint.searchParams.set("api-version", apiVersion);
  return endpoint.toString();
}

export function azureUsesResponses(credentials = {}) {
  return normalizeApiType(credentials?.providerSpecificData?.apiType ?? process.env.AZURE_API_TYPE) === "responses";
}

export class AzureExecutor extends DefaultExecutor {
  constructor() {
    super("azure");
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    return buildAzureEndpoint(model, credentials || {});
  }

  buildHeaders(credentials = {}, stream = true) {
    const providerSpecificData = credentials.providerSpecificData || {};
    const authMode = inferredAuthMode(
      credentials,
      providerSpecificData.authMode ?? process.env.AZURE_AUTH_MODE,
    );
    const organization = normalizeHeaderValue(
      providerSpecificData.organization ?? process.env.AZURE_ORGANIZATION,
      "organization",
    );
    const headers = {
      "Content-Type": "application/json",
      ...this.config.headers,
    };

    const apiKey = normalizeHeaderValue(
      firstNonEmpty(credentials.apiKey, credentials.accessToken, process.env.AZURE_OPENAI_API_KEY, process.env.OPENAI_API_KEY),
      "API credential",
    );
    const bearerToken = normalizeHeaderValue(
      firstNonEmpty(credentials.accessToken, credentials.apiKey, process.env.AZURE_ACCESS_TOKEN),
      "Bearer credential",
    );

    if ((authMode === "api-key" || authMode === "both") && !apiKey) {
      throw new Error("Azure API-key authentication requires a credential");
    }
    if ((authMode === "bearer" || authMode === "both") && !bearerToken) {
      throw new Error("Azure Bearer authentication requires a credential");
    }
    if (authMode === "api-key" || authMode === "both") headers["api-key"] = apiKey;
    if (authMode === "bearer" || authMode === "both") headers.Authorization = `Bearer ${bearerToken}`;
    if (organization) headers["OpenAI-Organization"] = organization;

    headers.Accept = stream ? "text/event-stream" : "application/json";
    return headers;
  }

  transformRequest(model, body, stream, credentials = {}) {
    if (!azureUsesResponses(credentials)) return body;

    const data = normalizeAzureProviderSpecificData(
      credentials.providerSpecificData || {},
      { credentials, model },
    );
    const transformed = { ...body, stream: true };
    if (data.deployment) transformed.model = data.deployment;
    if (transformed.max_output_tokens === undefined) {
      if (transformed.max_completion_tokens !== undefined) {
        transformed.max_output_tokens = transformed.max_completion_tokens;
      } else if (transformed.max_tokens !== undefined) {
        transformed.max_output_tokens = transformed.max_tokens;
      }
    }
    delete transformed.max_completion_tokens;
    delete transformed.max_tokens;
    return transformed;
  }

  parseError(response) {
    const messages = {
      400: "Azure rejected the request",
      401: "Azure authentication failed",
      403: "Azure authorization failed",
      404: "Azure endpoint or deployment was not found",
      429: "Azure rate limit exceeded",
    };
    return {
      status: response.status,
      message: messages[response.status] || `Azure upstream request failed (HTTP ${response.status})`,
    };
  }

  sanitizeClientError(error) {
    if (error?.name === "AbortError") return error;
    return new Error("Azure upstream request failed");
  }
}
