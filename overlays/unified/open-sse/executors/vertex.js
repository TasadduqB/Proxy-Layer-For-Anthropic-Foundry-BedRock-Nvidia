import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { parseVertexSaJson, refreshVertexToken, refreshGoogleToken } from "../services/tokenRefresh.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

// Cache project IDs resolved from raw API keys { apiKey → projectId }
const projectIdCache = new Map();

/** Parse Google ADC user credential JSON from apiKey string. */
function parseVertexAdcJson(apiKey) {
  if (typeof apiKey !== "string") return null;
  try {
    const parsed = JSON.parse(apiKey);
    if (
      parsed.type === "authorized_user" &&
      parsed.client_id &&
      parsed.client_secret &&
      parsed.refresh_token
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve GCP project ID from a raw Vertex API key.
 * Sends a dummy 404 request and parses "projects/{id}" from the error message.
 */
async function resolveProjectId(apiKey, proxyOptions = null) {
  if (projectIdCache.has(apiKey)) return projectIdCache.get(apiKey);

  const probe = new URL("https://aiplatform.googleapis.com/v1/publishers/google/models/__probe__:generateContent");
  probe.searchParams.set("key", apiKey);
  const res = await proxyAwareFetch(
    probe,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
    proxyOptions,
  );
  const json = await res.json().catch(() => null);
  const msg = json?.[0]?.error?.message || json?.error?.message || "";
  const match = msg.match(/projects\/([^/]+)\//);
  const projectId = match?.[1] || null;

  if (projectId) projectIdCache.set(apiKey, projectId);
  return projectId;
}

/**
 * VertexExecutor - Google Cloud Vertex AI
 *
 * "vertex"         → Gemini models via regional/global Vertex endpoint
 * "vertex-partner" → Partner models via global OpenAI-compatible endpoint
 */
export class VertexExecutor extends BaseExecutor {
  constructor(providerId = "vertex") {
    super(providerId, PROVIDERS[providerId] || {});
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const saJson = parseVertexSaJson(credentials?.apiKey);
    const adcJson = parseVertexAdcJson(credentials?.apiKey);
    const usesOAuth = !!saJson || !!adcJson || !!credentials?.accessToken;
    const rawKey = !usesOAuth ? credentials?.apiKey : null;
    const projectId =
      saJson?.project_id ||
      adcJson?.quota_project_id ||
      credentials?.providerSpecificData?.projectId;

    if (this.provider === "vertex-partner") {
      if (!projectId) throw new Error("Vertex partner models require a project_id. Add it in providerSpecificData or use Service Account JSON.");
      const encodedProject = encodeURIComponent(String(projectId));
      const url = new URL(`https://aiplatform.googleapis.com/v1/projects/${encodedProject}/locations/global/endpoints/openapi/chat/completions`);
      if (rawKey) url.searchParams.set("key", rawKey);
      return url.toString();
    }

    const action = stream ? "streamGenerateContent" : "generateContent";

    if (usesOAuth) {
      if (!projectId) {
        throw new Error(
          "Vertex OAuth/ADC requires a project_id. " +
          "Add quota_project_id to your ADC JSON or set providerSpecificData.projectId.",
        );
      }
      const location = credentials?.providerSpecificData?.location || "us-central1";
      const encodedProject = encodeURIComponent(String(projectId));
      const encodedLocation = encodeURIComponent(String(location));
      const encodedModel = encodeURIComponent(String(model));
      const url = new URL(
        `https://aiplatform.googleapis.com/v1/projects/${encodedProject}/locations/${encodedLocation}/publishers/google/models/${encodedModel}:${action}`,
      );
      if (stream) url.searchParams.set("alt", "sse");
      return url.toString();
    }

    const encodedModel = encodeURIComponent(String(model));
    const url = new URL(`https://aiplatform.googleapis.com/v1/publishers/google/models/${encodedModel}:${action}`);
    if (stream) url.searchParams.set("alt", "sse");
    if (rawKey) url.searchParams.set("key", rawKey);
    return url.toString();
  }

  buildHeaders(credentials, stream = true) {
    const headers = {
      "Content-Type": "application/json",
      Accept: stream ? "text/event-stream" : "application/json",
    };
    if (credentials.accessToken) headers.Authorization = `Bearer ${credentials.accessToken}`;
    return headers;
  }

  async refreshCredentials(credentials, log, proxyOptions = null) {
    const saJson = parseVertexSaJson(credentials?.apiKey);
    if (!saJson) return null;

    const result = await refreshVertexToken(saJson, log, proxyOptions);
    if (!result) return null;
    return { accessToken: result.accessToken, expiresAt: result.expiresAt };
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const saJson = parseVertexSaJson(credentials?.apiKey);
    const adcJson = parseVertexAdcJson(credentials?.apiKey);

    if (saJson) {
      const result = await refreshVertexToken(saJson, log, proxyOptions);
      if (!result?.accessToken) throw new Error("Vertex: failed to mint access token from Service Account JSON");
      credentials.accessToken = result.accessToken;
    }

    if (adcJson) {
      const result = await refreshGoogleToken(
        adcJson.refresh_token,
        adcJson.client_id,
        adcJson.client_secret,
        log,
        proxyOptions,
      );
      if (!result?.accessToken) throw new Error("Vertex: failed to refresh access token from ADC JSON (authorized_user)");
      credentials.accessToken = result.accessToken;
    }

    if (this.provider === "vertex-partner" && !saJson && !adcJson && !credentials?.providerSpecificData?.projectId) {
      const projectId = await resolveProjectId(credentials.apiKey, proxyOptions);
      if (!projectId) throw new Error("Vertex: could not resolve project_id from API key. Please add it manually in provider settings.");
      log?.debug?.("VERTEX", `Resolved project_id: ${projectId}`);
      credentials.providerSpecificData = { ...credentials.providerSpecificData, projectId };
    }

    const url = this.buildUrl(model, stream, 0, credentials);
    const headers = this.buildHeaders(credentials, stream);
    const transformedBody = this.transformRequest(model, body, stream, credentials);

    const response = await proxyAwareFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(transformedBody),
      signal,
    }, proxyOptions);

    return { response, url, headers, transformedBody };
  }
}

export default VertexExecutor;
