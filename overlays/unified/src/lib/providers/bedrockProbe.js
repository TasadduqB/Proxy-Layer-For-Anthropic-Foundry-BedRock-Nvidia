import {
  buildBedrockAnthropicBody,
  buildBedrockUrl,
  signBedrockRequest,
} from "../../../open-sse/executors/bedrock.js";

export const BEDROCK_PROBE_MODEL = "anthropic.claude-3-haiku-20240307-v1:0";
const MAX_ERROR_BYTES = 64 * 1024;
const AUTH_ERROR_CODES = new Set([
  "accessdeniedexception",
  "expiredtokenexception",
  "incompletesignature",
  "invalidclienttokenid",
  "invalidsignatureexception",
  "missingauthenticationtoken",
  "signaturedoesnotmatch",
  "unrecognizedclientexception",
]);
const AUTHENTICATED_ERROR_CODES = new Set([
  "badcscoreexception",
  "modelerrorexception",
  "modelnotreadyexception",
  "modeltimeoutexception",
  "resourcenotfoundexception",
  "servicequotaexceededexception",
  "throttlingexception",
  "validationexception",
]);

function normalizeErrorCode(value) {
  if (typeof value !== "string") return "";
  return value.split("#").pop().split(":")[0].trim().toLowerCase();
}

function parseAwsErrorCode(text) {
  if (typeof text !== "string" || !text.trim()) return "";
  try {
    const parsed = JSON.parse(text);
    return normalizeErrorCode(
      parsed?.__type || parsed?.code || parsed?.Code || parsed?.error?.code || parsed?.error?.type
    );
  } catch {
    return "";
  }
}

async function readBoundedText(response, maxBytes = MAX_ERROR_BYTES) {
  const reader = response?.body?.getReader?.();
  if (!reader) return "";
  const chunks = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - total;
      const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      chunks.push(chunk);
      total += chunk.byteLength;
      if (value.byteLength > remaining) break;
    }
  } finally {
    await reader.cancel("bounded Bedrock validation response").catch(() => {});
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

export function buildBedrockProbe({
  accessKeyId,
  secretAccessKey,
  sessionToken,
  region = "us-east-1",
  endpoint,
  model = BEDROCK_PROBE_MODEL,
  now = new Date(),
} = {}) {
  const url = buildBedrockUrl({ model, stream: false, region, endpoint });
  const body = JSON.stringify(buildBedrockAnthropicBody({
    max_tokens: 1,
    messages: [{ role: "user", content: [{ type: "text", text: "test" }] }],
  }));
  const headers = signBedrockRequest({
    url,
    body,
    accessKeyId,
    secretAccessKey,
    sessionToken,
    region,
    now,
  });
  return {
    url,
    options: {
      method: "POST",
      headers: { ...headers, Accept: "application/json" },
      body,
    },
  };
}

export async function classifyBedrockProbeResponse(response) {
  if (response?.ok) return { valid: true, error: null, status: response.status };
  const status = Number(response?.status) || 0;
  const errorBody = await readBoundedText(response);
  const code = parseAwsErrorCode(errorBody) || normalizeErrorCode(response?.headers?.get?.("x-amzn-errortype"));
  if (status === 401 || status === 403 || AUTH_ERROR_CODES.has(code)) {
    return {
      valid: false,
      error: "Invalid AWS credentials or insufficient Bedrock access",
      status,
    };
  }
  // These Bedrock service errors prove that AWS accepted the signed identity.
  if (AUTHENTICATED_ERROR_CODES.has(code)) return { valid: true, error: null, status };
  if (status >= 400 && status < 500) {
    return { valid: false, error: "AWS Bedrock validation failed", status };
  }
  return {
    valid: false,
    error: "AWS Bedrock validation is temporarily unavailable",
    status,
  };
}

/** Shared validation used by both unsaved-provider validation and saved tests. */
export async function probeBedrockConnection({
  accessKeyId,
  providerSpecificData = {},
  model,
  fetchImpl = fetch,
  fetchProxyOptions,
  signal,
  now,
} = {}) {
  try {
    const probe = buildBedrockProbe({
      accessKeyId,
      secretAccessKey: providerSpecificData.secretAccessKey,
      sessionToken: providerSpecificData.sessionToken,
      region: providerSpecificData.region || "us-east-1",
      endpoint: providerSpecificData.endpoint,
      model: model || providerSpecificData.model || BEDROCK_PROBE_MODEL,
      now,
    });
    const response = await fetchImpl(probe.url, { ...probe.options, signal }, fetchProxyOptions);
    return await classifyBedrockProbeResponse(response);
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    return { valid: false, error: "Unable to validate AWS Bedrock configuration", status: 0 };
  }
}
