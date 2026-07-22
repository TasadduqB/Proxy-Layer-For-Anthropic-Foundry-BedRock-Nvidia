import {
  AzureExecutor,
  azureUsesResponses,
  normalizeAzureProviderSpecificData,
} from "open-sse/executors/azure.js";
import { translateRequest } from "open-sse/translator/index.js";
import { FORMATS } from "open-sse/translator/formats.js";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";

const DEFAULT_PROBE_MODEL = "gpt-4";

/**
 * Build the same target URL, authentication headers, request translation, and
 * final executor transform used by the Azure runtime. Both validation routes
 * consume this object so endpoint modes cannot drift between code paths.
 */
export function buildAzureProbe({
  apiKey,
  accessToken,
  providerSpecificData = {},
  model,
}) {
  const executor = new AzureExecutor();
  const credentials = { apiKey, accessToken, providerSpecificData };
  const normalized = normalizeAzureProviderSpecificData(providerSpecificData, {
    credentials,
    model: model || providerSpecificData.deployment || DEFAULT_PROBE_MODEL,
  });
  const upstreamModel = normalized.deployment || model || DEFAULT_PROBE_MODEL;
  const responses = azureUsesResponses(credentials);
  const stream = responses;
  const sourceBody = {
    model: upstreamModel,
    messages: [{ role: "user", content: "test" }],
    max_completion_tokens: 1,
    stream,
  };
  const translatedBody = responses
    ? translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI_RESPONSES,
      upstreamModel,
      sourceBody,
      true,
      credentials,
      "azure",
    )
    : sourceBody;
  const body = executor.transformRequest(upstreamModel, translatedBody, stream, credentials);

  return {
    url: executor.buildUrl(upstreamModel, stream, 0, credentials),
    targetFormat: responses ? FORMATS.OPENAI_RESPONSES : FORMATS.OPENAI,
    forceStream: responses,
    options: {
      method: "POST",
      headers: executor.buildHeaders(credentials, stream),
      body: JSON.stringify(body),
    },
  };
}

// Backward-compatible export retained for existing callers.
export const buildAzureChatProbe = buildAzureProbe;

/** Execute the canonical probe through the same proxy-aware fetch as runtime. */
export async function executeAzureProbe(config, options = {}) {
  const probe = buildAzureProbe(config);
  const fetchFn = options.fetchFn || proxyAwareFetch;
  const signal = options.signal || AbortSignal.timeout(10_000);
  const response = await fetchFn(
    probe.url,
    { ...probe.options, signal },
    options.proxyOptions || null,
  );
  return { response, probe };
}
