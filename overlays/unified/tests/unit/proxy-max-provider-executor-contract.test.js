import { describe, expect, it, vi } from "vitest";

const { proxyFetchMock } = vi.hoisted(() => ({ proxyFetchMock: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, proxyAwareFetch: proxyFetchMock };
});
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { parseModel, resolveProviderAlias } from "../../open-sse/services/model.js";
import { resolveTransport } from "../../open-sse/services/provider.js";
import { getExecutor, hasSpecializedExecutor } from "../../open-sse/executors/index.js";
import { AzureExecutor } from "../../open-sse/executors/azure.js";
import { OllamaLocalExecutor } from "../../open-sse/executors/ollama-local.js";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";
import { QwenExecutor } from "../../open-sse/executors/qwen.js";

const EXPECTED_PROVIDER_IDS = [
  "alicode", "alicode-intl", "alims-intl", "anthropic", "antigravity",
  "assemblyai", "aws-polly", "azure", "bedrock", "black-forest-labs", "blackbox",
  "brave-search", "byteplus", "cartesia", "cerebras", "chutes", "claude",
  "cline", "clinepass", "cloudflare-ai", "codebuddy-cn", "codex", "cohere",
  "comfyui", "commandcode", "coqui", "cursor", "deepgram", "deepseek",
  "edge-tts", "elevenlabs", "exa", "fal-ai", "featherless", "firecrawl",
  "fireworks", "gemini", "gemini-cli", "github", "gitlab", "glm", "glm-cn",
  "google-pse", "google-tts", "grok-cli", "grok-web", "groq", "huggingface",
  "hyperbolic", "iflow", "inworld", "jina-ai", "jina-reader", "kilocode",
  "kimchi", "kimi", "kiro", "linkup", "local-device", "mimo-free", "minimax",
  "minimax-cn", "mistral", "mmf", "nanobanana", "nebius", "nvidia", "ollama",
  "ollama-local", "openai", "opencode", "opencode-go", "openrouter", "perplexity",
  "perplexity-agent", "perplexity-web", "playht", "qoder", "qwen", "recraft",
  "runwayml", "sdwebui", "searchapi", "searxng", "serper", "siliconflow",
  "stability-ai", "tavily", "together", "topaz", "tortoise", "venice",
  "vercel-ai-gateway", "vertex", "vertex-partner", "volcengine-ark", "voyage-ai",
  "xai", "xiaomi-mimo", "xiaomi-tokenplan", "youcom",
];

const SPECIALIZED_TOKENS = [
  "antigravity", "azure", "bedrock", "codebuddy-cn", "codex", "commandcode", "cursor", "cu",
  "gb", "gcli", "gemini-cli", "github", "grok-cli", "grok-web", "iflow", "kimchi",
  "kiro", "mimo-free", "mmf", "ollama-local", "opencode", "opencode-go",
  "perplexity-web", "qoder", "qwen", "vertex", "vertex-partner", "xiaomi-tokenplan",
];

const ADVERTISED_USAGE_PROVIDERS = [
  "antigravity", "claude", "codebuddy-cn", "codex", "gemini-cli", "github", "glm",
  "glm-cn", "grok-cli", "kiro", "minimax", "minimax-cn", "ollama", "qoder",
  "vercel-ai-gateway",
];

const URL_SENTINELS = new Set(["edge-tts", "google-tts", "local-device"]);
const AUTH_HOOKS = new Set(["claudeOverlay", "clineHeaders", "kilocodeOrg", "kimiHeaders"]);

function expectAbsoluteHttpUrl(value, label) {
  expect(typeof value, label).toBe("string");
  let parsed;
  expect(() => { parsed = new URL(value); }, label).not.toThrow();
  expect(["http:", "https:"], label).toContain(parsed.protocol);
  expect(parsed.username, label).toBe("");
  expect(parsed.password, label).toBe("");
}

function assertAuthDescriptor(auth, label) {
  expect(auth && typeof auth, label).toBe("object");
  if (auth.combined) {
    expect(typeof auth.header, `${label}.header`).toBe("string");
    expect(["raw", "bearer"], `${label}.scheme`).toContain(auth.scheme);
  } else {
    for (const branch of ["apiKey", "oauth"]) {
      expect(typeof auth[branch]?.header, `${label}.${branch}.header`).toBe("string");
      expect(["raw", "bearer"], `${label}.${branch}.scheme`).toContain(auth[branch]?.scheme);
    }
  }
  for (const hook of auth.hooks || []) expect(AUTH_HOOKS.has(hook), `${label}.hooks.${hook}`).toBe(true);
}

function makeCredentials() {
  return {
    apiKey: "contract-api-key",
    accessToken: "contract-access-token",
    copilotToken: "contract-copilot-token",
    refreshToken: "contract-refresh-token",
    connectionId: "contract-connection",
    projectId: "contract-project",
    providerSpecificData: {
      accountId: "contract-account",
      secretAccessKey: "contract-aws-secret",
      sessionToken: "contract-aws-session",
      azureEndpoint: "https://contract.openai.azure.com",
      apiVersion: "2025-01-01-preview",
      deployment: "contract-deployment",
      organization: "contract-org",
      projectId: "contract-project",
      location: "us-central1",
      region: "sgp",
      resourceUrl: "https://portal.qwen.ai",
      baseUrl: "http://127.0.0.1:11434",
      machineId: "contract-machine-id",
      userId: "contract-user-id",
      authMethod: "google",
    },
  };
}

describe("complete provider registry contract", () => {
  it("loads the exact 101 pinned and Proxy-Max registry entries with unique valid ids", () => {
    const ids = REGISTRY.map((entry) => entry.id);
    expect([...ids].sort()).toEqual(EXPECTED_PROVIDER_IDS);
    expect(new Set(ids).size).toBe(101);
    for (const entry of REGISTRY) {
      expect(entry.id, "provider id").toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(["apikey", "oauth", "freeTier", "free", "webCookie"], entry.id).toContain(entry.category);
      expect(entry.display?.name, `${entry.id}.display.name`).toBeTruthy();
      if (entry.display?.website) expectAbsoluteHttpUrl(entry.display.website, `${entry.id}.display.website`);
      for (const [key, value] of Object.entries(entry.display?.notice || {})) {
        if (key.toLowerCase().endsWith("url")) expectAbsoluteHttpUrl(value, `${entry.id}.notice.${key}`);
      }
    }
  });

  it("builds runtime transports for every one of the 69 transport providers", () => {
    const ids = REGISTRY.filter((entry) => entry.transport).map((entry) => entry.id).sort();
    expect(Object.keys(PROVIDERS).sort()).toEqual(ids);
    expect(ids).toHaveLength(69);
    for (const id of ids) {
      expect(PROVIDERS[id].format, `${id}.format`).toBeTruthy();
      expect(PROVIDERS[id].transports).toEqual(REGISTRY.find((entry) => entry.id === id).transports);
    }
  });

  it("validates all chat, fallback, validation, and multi-transport URL shapes", () => {
    for (const entry of REGISTRY) {
      const transport = entry.transport;
      if (transport?.baseUrl) expectAbsoluteHttpUrl(transport.baseUrl.replace("{accountId}", "account"), `${entry.id}.baseUrl`);
      if (transport?.baseUrls) {
        expect(transport.baseUrls.length, `${entry.id}.baseUrls`).toBeGreaterThan(0);
        transport.baseUrls.forEach((url, i) => expectAbsoluteHttpUrl(url, `${entry.id}.baseUrls[${i}]`));
      }
      if (transport?.validateUrl) expectAbsoluteHttpUrl(transport.validateUrl, `${entry.id}.validateUrl`);
      for (const [i, variant] of (entry.transports || []).entries()) {
        expect(typeof variant.format, `${entry.id}.transports[${i}].format`).toBe("string");
        if (variant.baseUrl) expectAbsoluteHttpUrl(variant.baseUrl, `${entry.id}.transports[${i}].baseUrl`);
      }
      for (const key of ["ttsConfig", "sttConfig", "embeddingConfig", "imageConfig", "searchConfig", "fetchConfig"]) {
        const baseUrl = entry[key]?.baseUrl;
        if (baseUrl && !URL_SENTINELS.has(baseUrl)) expectAbsoluteHttpUrl(baseUrl, `${entry.id}.${key}.baseUrl`);
      }
    }
  });

  it("validates every declared auth and retry descriptor", () => {
    for (const entry of REGISTRY) {
      if (entry.transport?.auth) assertAuthDescriptor(entry.transport.auth, `${entry.id}.transport.auth`);
      for (const [i, variant] of (entry.transports || []).entries()) {
        if (variant.auth) assertAuthDescriptor(variant.auth, `${entry.id}.transports[${i}].auth`);
      }
      for (const [status, retry] of Object.entries(entry.transport?.retry || {})) {
        expect(Number(status), `${entry.id}.retry status`).toBeGreaterThanOrEqual(400);
        const attempts = typeof retry === "number" ? retry : retry.attempts;
        const delayMs = typeof retry === "object" ? retry.delayMs : undefined;
        expect(Number.isInteger(attempts), `${entry.id}.retry.${status}.attempts`).toBe(true);
        expect(attempts, `${entry.id}.retry.${status}.attempts`).toBeGreaterThanOrEqual(0);
        if (delayMs !== undefined) expect(delayMs, `${entry.id}.retry.${status}.delayMs`).toBeGreaterThanOrEqual(0);
      }
    }
    expect(PROVIDERS.antigravity.retry[429].attempts).toBe(6);
    expect(PROVIDERS.antigravity.retry[503].attempts).toBe(3);
  });

  it("resolves every id, alias, and extra alias deterministically", () => {
    const owners = new Map();
    for (const entry of REGISTRY) {
      for (const token of [entry.id, entry.alias, ...(entry.aliases || [])].filter(Boolean)) {
        const set = owners.get(token) || new Set();
        set.add(entry.id);
        owners.set(token, set);
      }
    }
    expect([...owners].filter(([, set]) => set.size > 1).map(([token]) => token)).toEqual(["mmf"]);

    for (const entry of REGISTRY) {
      for (const token of [entry.id, entry.alias, ...(entry.aliases || [])].filter(Boolean)) {
        const expected = token === "mmf" ? "mmf" : entry.id;
        expect(resolveProviderAlias(token), token).toBe(expected);
        expect(parseModel(`${token}/contract-model`).provider, token).toBe(expected);
      }
    }
  });

  it("normalizes every declared model without collisions inside a modality", () => {
    for (const entry of REGISTRY) {
      if (entry.models === undefined) continue;
      const key = entry.alias || entry.id;
      expect(PROVIDER_MODELS[key], `${entry.id} model table`).toHaveLength(entry.models.length);
      const seen = new Set();
      for (const model of PROVIDER_MODELS[key]) {
        expect(typeof model.id, `${entry.id} model id`).toBe("string");
        expect(model.id.length, `${entry.id} model id`).toBeGreaterThan(0);
        expect(typeof model.name, `${entry.id}/${model.id} name`).toBe("string");
        const identity = `${model.kind || model.type || "llm"}:${model.id}`;
        expect(seen.has(identity), `${entry.id} duplicate ${identity}`).toBe(false);
        seen.add(identity);
      }
    }
  });

  it("resolves both runtime transports for every dual-protocol provider", () => {
    const multi = REGISTRY.filter((entry) => entry.transports);
    expect(multi.map((entry) => entry.id).sort()).toEqual([
      "deepseek", "glm", "kimi", "minimax", "minimax-cn", "xiaomi-mimo", "xiaomi-tokenplan",
    ]);
    for (const entry of multi) {
      expect(resolveTransport(entry.id, "openai")?.format, `${entry.id} openai`).toBe("openai");
      expect(resolveTransport(entry.id, "claude")?.format, `${entry.id} claude`).toBe("claude");
      expect(resolveTransport(entry.id, "gemini"), `${entry.id} unsupported`).toBeNull();
    }
  });

  it("advertises usage only for providers with implemented dispatch", () => {
    const advertised = REGISTRY.filter((entry) => entry.features?.usage).map((entry) => entry.id).sort();
    expect(advertised).toEqual(ADVERTISED_USAGE_PROVIDERS);
    expect(REGISTRY.find((entry) => entry.id === "kimi").features?.usage).not.toBe(true);
  });
});

describe("complete executor routing and transport contract", () => {
  it("registers the exact specialized provider ids and aliases", () => {
    for (const token of SPECIALIZED_TOKENS) expect(hasSpecializedExecutor(token), token).toBe(true);
    const specializedProviderIds = REGISTRY.filter((entry) => hasSpecializedExecutor(entry.id)).map((entry) => entry.id).sort();
    expect(specializedProviderIds).toEqual([
      "antigravity", "azure", "bedrock", "codebuddy-cn", "codex", "commandcode", "cursor",
      "gemini-cli", "github", "grok-cli", "grok-web", "iflow", "kimchi", "kiro",
      "mimo-free", "mmf", "ollama-local", "opencode", "opencode-go", "perplexity-web",
      "qoder", "qwen", "vertex", "vertex-partner", "xiaomi-tokenplan",
    ]);
    expect(getExecutor("cu").getProvider()).toBe("cursor");
    expect(getExecutor("gcli").getProvider()).toBe("grok-cli");
    expect(getExecutor("gb").getProvider()).toBe("grok-cli");
    expect(getExecutor("mmf").getProvider()).toBe("mimo-free");
  });

  it("builds an offline URL and header set for all 69 transport providers", () => {
    for (const entry of REGISTRY.filter((item) => item.transport)) {
      const executor = getExecutor(entry.id);
      const credentials = makeCredentials();
      const model = entry.models?.find((item) => (item.kind || item.type || "llm") === "llm")?.id || "contract-model";
      const url = executor.buildUrl(model, true, 0, credentials);
      expectAbsoluteHttpUrl(url, `${entry.id} executor URL`);
      expect(url, `${entry.id} executor URL`).not.toMatch(/(?:undefined|null)/i);

      const headers = executor.buildHeaders(credentials, true);
      expect(headers && typeof headers, `${entry.id} headers`).toBe("object");
      for (const [key, value] of Object.entries(headers)) {
        expect(typeof key, `${entry.id} header key`).toBe("string");
        expect(value, `${entry.id}.${key}`).not.toBeNull();
        expect(value, `${entry.id}.${key}`).not.toBeUndefined();
        expect(String(value), `${entry.id}.${key}`).not.toMatch(/(?:Bearer )?undefined|null/i);
      }
    }
  });

  it("negotiates streaming and JSON response types without undefined headers", () => {
    const forced = REGISTRY.filter((entry) => entry.transport?.forceStream).map((entry) => entry.id).sort();
    expect(forced).toEqual(["codebuddy-cn", "codex", "commandcode", "grok-cli", "openai"]);

    for (const entry of REGISTRY.filter((item) => item.transport)) {
      const executor = getExecutor(entry.id);
      const credentials = makeCredentials();
      const streaming = executor.buildHeaders(credentials, true);
      const json = executor.buildHeaders(credentials, false);
      for (const [mode, headers] of [["stream", streaming], ["json", json]]) {
        for (const [key, value] of Object.entries(headers)) {
          expect(value, `${entry.id}.${mode}.${key}`).not.toBeUndefined();
          expect(value, `${entry.id}.${mode}.${key}`).not.toBeNull();
        }
      }
      // Kiro always uses AWS EventStream on the upstream wire. Every other
      // executor that advertises an Accept value for non-streaming must ask for JSON.
      if (entry.id !== "kiro" && json.Accept !== undefined) {
        expect(json.Accept, `${entry.id} non-stream Accept`).not.toBe("text/event-stream");
      }
    }
  });

  it("hardens Azure endpoint construction and supports API-key or Entra auth", () => {
    const executor = new AzureExecutor();
    const credentials = makeCredentials();
    credentials.providerSpecificData.deployment = "prod blue/v2";
    const url = executor.buildUrl("ignored", true, 0, credentials);
    expect(url).toBe("https://contract.openai.azure.com/openai/deployments/prod%20blue%2Fv2/chat/completions?api-version=2025-01-01-preview");
    expect(executor.buildHeaders(credentials, false)).toMatchObject({
      "api-key": "contract-api-key",
      "Accept": "application/json",
    });

    const saved = {
      AZURE_OPENAI_API_KEY: process.env.AZURE_OPENAI_API_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      AZURE_ACCESS_TOKEN: process.env.AZURE_ACCESS_TOKEN,
      AZURE_ENDPOINT: process.env.AZURE_ENDPOINT,
    };
    try {
      delete process.env.AZURE_OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.AZURE_ACCESS_TOKEN;
      delete process.env.AZURE_ENDPOINT;
      expect(executor.buildHeaders({ accessToken: "entra-token", providerSpecificData: {} }, true)).toMatchObject({
        Authorization: "Bearer entra-token",
        Accept: "text/event-stream",
      });
      expect(() => executor.buildUrl("model", true, 0, { providerSpecificData: {} })).toThrow(/Azure endpoint is required/i);
      expect(() => executor.buildUrl("model", true, 0, { providerSpecificData: { azureEndpoint: "file:///tmp/x" } })).toThrow(/http or https/i);
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("keeps local Ollama credential-free with accurate response media types", () => {
    const executor = new OllamaLocalExecutor();
    expect(PROVIDERS["ollama-local"].noAuth).toBe(true);
    expect(executor.buildUrl("model", true, 0, { providerSpecificData: {} })).toBe("http://localhost:11434/api/chat");
    expect(executor.buildHeaders({}, true)).toEqual({
      "Content-Type": "application/json",
      Accept: "application/x-ndjson",
    });
    expect(executor.buildHeaders({}, false)).toEqual({
      "Content-Type": "application/json",
      Accept: "application/json",
    });
  });

  it("normalizes Qwen OAuth shard URLs to a safe HTTPS origin", () => {
    const executor = new QwenExecutor();
    expect(executor.buildUrl("model", true, 0, { providerSpecificData: {} })).toBe("https://portal.qwen.ai/v1/chat/completions");
    expect(executor.buildUrl("model", true, 0, { providerSpecificData: { resourceUrl: "regional.qwen.ai/tenant/v1" } })).toBe("https://regional.qwen.ai/v1/chat/completions");
    expect(executor.buildUrl("model", true, 0, { providerSpecificData: { resourceUrl: "https://regional.qwen.ai/base?ignored=1" } })).toBe("https://regional.qwen.ai/v1/chat/completions");
    expect(() => executor.buildUrl("model", true, 0, { providerSpecificData: { resourceUrl: "http://127.0.0.1:8080" } })).toThrow(/must use https/i);
    expect(() => executor.buildUrl("model", true, 0, { providerSpecificData: { resourceUrl: "https://user:pass@regional.qwen.ai" } })).toThrow(/credentials/i);
  });

  it("refreshes Qwen credentials through the connection-aware proxy transport", async () => {
    proxyFetchMock.mockReset();
    proxyFetchMock.mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));
    proxyFetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 3600,
        resource_url: "https://regional.qwen.ai/tenant/v1",
      }),
    });
    const executor = new QwenExecutor();
    const proxyOptions = { enabled: true, url: "http://127.0.0.1:7890", strictProxy: true };
    const credentials = {
      accessToken: "expired-access",
      refreshToken: "old-refresh",
      providerSpecificData: { keep: "value" },
    };
    const firstAttempt = await executor.execute({
      model: "coder-model",
      body: { messages: [{ role: "user", content: "hello" }] },
      stream: true,
      credentials,
      proxyOptions,
    });
    expect(firstAttempt.response.status).toBe(401);
    const result = await executor.refreshCredentials(credentials, null);

    expect(proxyFetchMock).toHaveBeenCalledTimes(2);
    expect(proxyFetchMock.mock.calls[0][2]).toBe(proxyOptions);
    expect(proxyFetchMock.mock.calls[1][2]).toBe(proxyOptions);
    expect(result).toEqual({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresIn: 3600,
      providerSpecificData: {
        keep: "value",
        resourceUrl: "https://regional.qwen.ai/tenant/v1",
      },
    });
  });

  it("refreshes Gemini CLI credentials through the connection-aware proxy transport", async () => {
    proxyFetchMock.mockReset();
    proxyFetchMock.mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));
    proxyFetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "gemini-access", refresh_token: "gemini-refresh", expires_in: 1800 }),
    });
    const proxyOptions = { enabled: true, url: "http://127.0.0.1:7890" };
    const executor = getExecutor("gemini-cli");
    const credentials = {
      accessToken: "expired-access",
      refreshToken: "old-refresh",
      projectId: "project-one",
    };
    const firstAttempt = await executor.execute({
      model: "gemini-model",
      body: { contents: [{ role: "user", parts: [{ text: "hello" }] }] },
      stream: true,
      credentials,
      proxyOptions,
    });
    expect(firstAttempt.response.status).toBe(401);
    const result = await executor.refreshCredentials(credentials, null);

    expect(proxyFetchMock).toHaveBeenCalledTimes(2);
    expect(proxyFetchMock.mock.calls[0][2]).toBe(proxyOptions);
    expect(proxyFetchMock.mock.calls[1][2]).toBe(proxyOptions);
    expect(result).toEqual({
      accessToken: "gemini-access",
      refreshToken: "gemini-refresh",
      expiresIn: 1800,
      projectId: "project-one",
    });
  });

  it("uses JSON negotiation for non-streaming OpenCode requests", () => {
    const executor = new OpenCodeExecutor();
    expect(executor.buildHeaders({}, true).Accept).toBe("text/event-stream");
    expect(executor.buildHeaders({}, false).Accept).toBe("application/json");
  });

  it("covers underserved specialized request transforms without network access", () => {
    const geminiCli = getExecutor("gemini-cli");
    const wrapped = geminiCli.transformRequest(
      "gemini-3-flash-preview",
      { contents: [{ role: "user", parts: [{ text: "hello" }] }] },
      true,
      { projectId: "project-one" },
    );
    expect(wrapped).toMatchObject({ project: "project-one", model: "gemini-3-flash-preview" });
    expect(wrapped.request.contents[0].parts[0].text).toBe("hello");

    const iflowBody = { messages: [{ role: "user", content: "hello" }] };
    expect(getExecutor("iflow").transformRequest("model", iflowBody, true, makeCredentials()).stream_options).toEqual({ include_usage: true });

    const qwenBody = getExecutor("qwen").transformRequest("model", {
      messages: [{ role: "user", content: "hello" }],
      thinking: { type: "enabled" },
      tool_choice: "required",
    }, true, makeCredentials());
    expect(qwenBody.messages[0].role).toBe("system");
    expect(qwenBody.tool_choice).toBe("auto");

    const xiaomi = getExecutor("xiaomi-tokenplan");
    const creds = makeCredentials();
    creds.providerSpecificData.region = "cn";
    creds.runtimeTransport = resolveTransport("xiaomi-tokenplan", "claude");
    expect(xiaomi.buildUrl("mimo-v2.5-pro", true, 0, creds)).toBe("https://token-plan-cn.xiaomimimo.com/anthropic/v1/messages");
    creds.runtimeTransport = resolveTransport("xiaomi-tokenplan", "openai");
    expect(xiaomi.buildUrl("mimo-v2.5-pro", true, 0, creds)).toBe("https://token-plan-cn.xiaomimimo.com/v1/chat/completions");

    const vertexCreds = makeCredentials();
    vertexCreds.apiKey = undefined;
    expect(getExecutor("vertex").buildUrl("gemini-3-flash-preview", true, 0, vertexCreds)).toBe(
      "https://aiplatform.googleapis.com/v1/projects/contract-project/locations/us-central1/publishers/google/models/gemini-3-flash-preview:streamGenerateContent?alt=sse",
    );
    expect(getExecutor("vertex-partner").buildUrl("deepseek-ai/deepseek-v3.2-maas", false, 0, vertexCreds)).toBe(
      "https://aiplatform.googleapis.com/v1/projects/contract-project/locations/global/endpoints/openapi/chat/completions",
    );
  });

  it("uses the connection proxy for Vertex project discovery and safely encodes API keys", async () => {
    proxyFetchMock.mockReset();
    proxyFetchMock
      .mockResolvedValueOnce({
        json: async () => ({ error: { message: "resource belongs to projects/discovered-project/locations/global" } }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    const proxyOptions = { enabled: true, url: "http://127.0.0.1:7890" };
    const credentials = { apiKey: "raw key&value", providerSpecificData: {} };
    const result = await getExecutor("vertex-partner").execute({
      model: "deepseek-ai/deepseek-v3.2-maas",
      body: { model: "deepseek-ai/deepseek-v3.2-maas", messages: [{ role: "user", content: "hello" }] },
      stream: false,
      credentials,
      proxyOptions,
    });

    expect(proxyFetchMock).toHaveBeenCalledTimes(2);
    expect(proxyFetchMock.mock.calls[0][2]).toBe(proxyOptions);
    expect(proxyFetchMock.mock.calls[1][2]).toBe(proxyOptions);
    expect(new URL(proxyFetchMock.mock.calls[0][0]).searchParams.get("key")).toBe("raw key&value");
    expect(new URL(result.url).searchParams.get("key")).toBe("raw key&value");
    expect(result.url).toContain("/projects/discovered-project/");
  });

  it("keeps web-cookie validation errors offline in specialized executors", async () => {
    for (const provider of ["grok-web", "perplexity-web"]) {
      const result = await getExecutor(provider).execute({
        model: "model",
        body: { messages: [] },
        stream: false,
        credentials: {},
      });
      expect(result.response.status, provider).toBe(400);
    }
  });
});
