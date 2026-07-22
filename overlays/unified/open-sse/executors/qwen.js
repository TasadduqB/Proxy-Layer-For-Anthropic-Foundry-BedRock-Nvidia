import { DefaultExecutor } from "./default.js";
import { PROVIDERS } from "../config/providers.js";
import { OAUTH_ENDPOINTS } from "../config/appConstants.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

/** portal.qwen.ai — static fingerprint matching stable Qwen Code release */
const QWEN_USER_AGENT = "QwenCode/0.12.3 (linux; x64)";
const QWEN_STAINLESS = {
  os: "Linux",
  arch: "x64",
  lang: "js",
  runtime: "node",
  runtimeVersion: "v18.19.1",
  packageVersion: "5.11.0",
  retryCount: "1",
};
const QWEN_DEFAULT_SYSTEM_MESSAGE = {
  role: "system",
  content: [{ type: "text", text: "", cache_control: { type: "ephemeral" } }],
};
const proxyOptionsByCredentials = new WeakMap();

function ensureQwenSystemMessage(body) {
  if (!body || typeof body !== "object") return body;
  const next = { ...body };
  if (Array.isArray(next.messages)) {
    next.messages = [QWEN_DEFAULT_SYSTEM_MESSAGE, ...next.messages];
  } else {
    next.messages = [QWEN_DEFAULT_SYSTEM_MESSAGE];
  }
  return next;
}

function isQwenThinkingActive(body) {
  const thinking = body?.thinking;
  if (thinking === true || body?.enable_thinking === true) return true;
  return typeof thinking === "object" && thinking !== null && !Array.isArray(thinking) && thinking.type === "enabled";
}

// Qwen rejects tool_choice="required" or object forms when thinking is active; neutralize to "auto".
function sanitizeQwenThinkingToolChoice(body) {
  if (!isQwenThinkingActive(body)) return body;
  const tc = body.tool_choice;
  const incompatible = tc === "required" || (typeof tc === "object" && tc !== null);
  if (!incompatible) return body;
  return { ...body, tool_choice: "auto" };
}

function buildQwenUpstreamHeaders(credentials, stream = true) {
  const token = credentials?.apiKey || credentials?.accessToken || "";
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    "User-Agent": QWEN_USER_AGENT,
    "X-DashScope-AuthType": "qwen-oauth",
    "X-DashScope-CacheControl": "enable",
    "X-DashScope-UserAgent": QWEN_USER_AGENT,
    "X-Stainless-Arch": QWEN_STAINLESS.arch,
    "X-Stainless-Lang": QWEN_STAINLESS.lang,
    "X-Stainless-Os": QWEN_STAINLESS.os,
    "X-Stainless-Package-Version": QWEN_STAINLESS.packageVersion,
    "X-Stainless-Retry-Count": QWEN_STAINLESS.retryCount,
    "X-Stainless-Runtime": QWEN_STAINLESS.runtime,
    "X-Stainless-Runtime-Version": QWEN_STAINLESS.runtimeVersion,
    Connection: "keep-alive",
    "Accept-Language": "*",
    "Sec-Fetch-Mode": "cors",
  };
  headers.Accept = stream ? "text/event-stream" : "application/json";
  return headers;
}

function resolveQwenResourceOrigin(resourceUrl) {
  const raw = typeof resourceUrl === "string" ? resourceUrl.trim() : "";
  if (!raw) return "https://portal.qwen.ai";

  let parsed;
  try {
    parsed = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    throw new Error("Qwen resource_url is not a valid host or URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Qwen resource_url must use https");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Qwen resource_url cannot contain credentials");
  }
  return parsed.origin;
}

export class QwenExecutor extends DefaultExecutor {
  constructor() {
    super("qwen");
  }

  // Qwen tokens are bound to a resource_url returned at OAuth time. Normalize
  // it to an origin so a trailing path cannot produce /v1/v1 or inject query data.
  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const origin = resolveQwenResourceOrigin(credentials?.providerSpecificData?.resourceUrl);
    return `${origin}/v1/chat/completions`;
  }

  buildHeaders(credentials, stream = true) {
    return buildQwenUpstreamHeaders(credentials, stream);
  }

  transformRequest(model, body, stream, credentials) {
    let next = body && typeof body === "object" ? { ...body } : body;
    if (stream && next?.messages && !next.stream_options && !next.thinking && !next.enable_thinking && next.stream !== false) {
      next.stream_options = { include_usage: true };
    }
    next = sanitizeQwenThinkingToolChoice(next);
    return ensureQwenSystemMessage(next);
  }

  async execute(options) {
    const credentials = options?.credentials;
    if (credentials && typeof credentials === "object") {
      proxyOptionsByCredentials.set(credentials, options.proxyOptions ?? null);
    }
    return super.execute(options);
  }

  // Override to capture resource_url from refresh response (required for buildUrl).
  async refreshCredentials(credentials, log, proxyOptions = null) {
    if (!credentials?.refreshToken) return null;
    const effectiveProxyOptions = proxyOptions ?? proxyOptionsByCredentials.get(credentials) ?? null;
    try {
      const response = await proxyAwareFetch(OAUTH_ENDPOINTS.qwen.token, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: credentials.refreshToken,
          client_id: PROVIDERS.qwen.clientId,
        }),
      }, effectiveProxyOptions);
      if (!response.ok) return null;
      const tokens = await response.json();
      log?.info?.("TOKEN", "qwen refreshed");
      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || credentials.refreshToken,
        expiresIn: tokens.expires_in,
        providerSpecificData: {
          ...(credentials.providerSpecificData || {}),
          ...(tokens.resource_url ? { resourceUrl: tokens.resource_url } : {}),
        },
      };
    } catch (error) {
      log?.error?.("TOKEN", `qwen refresh error: ${error.message}`);
      return null;
    }
  }
}

export default QwenExecutor;
