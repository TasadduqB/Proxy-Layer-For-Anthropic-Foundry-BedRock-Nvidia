import { describe, expect, it, vi } from "vitest";

import { resolveAzureModels } from "../../src/lib/providers/azureModels.js";
import { resolveBedrockModels } from "../../src/lib/providers/bedrockModels.js";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Azure AI Foundry live model catalog", () => {
  it("merges configured deployments with account and endpoint model discovery", async () => {
    const fetchFn = vi.fn(async (url, options) => {
      expect(options.headers["api-key"]).toBe("azure-key");
      if (url.includes("/openai/models?")) {
        return jsonResponse({ data: [
          { id: "gpt-5", name: "GPT-5" },
          { id: "text-embedding-3-large" },
        ] });
      }
      if (url.includes("/models/info?")) {
        return jsonResponse({ model_name: "Phi-4", model_display_name: "Phi-4" });
      }
      return jsonResponse({ error: "unsupported route" }, 404);
    });

    const result = await resolveAzureModels({
      id: "azure-test",
      apiKey: "azure-key",
      providerSpecificData: {
        azureEndpoint: "https://example.openai.azure.com/",
        deployment: "production-chat",
        authMode: "api-key",
      },
    }, { fetchFn, forceRefresh: true });

    expect(result.models.map((model) => model.id)).toEqual(expect.arrayContaining([
      "production-chat",
      "gpt-5",
      "text-embedding-3-large",
      "Phi-4",
    ]));
    expect(result.models.find((model) => model.id === "text-embedding-3-large")?.kind).toBe("embedding");
  });

  it("uses Foundry project deployment names as callable model ids", async () => {
    const fetchFn = vi.fn(async (url) => {
      if (url.includes("/api/projects/risk/deployments?")) {
        return jsonResponse({ value: [{ name: "risk-chat", properties: { model: { name: "DeepSeek-V3" } } }] });
      }
      return jsonResponse({}, 404);
    });
    const result = await resolveAzureModels({
      id: "azure-project-test",
      apiKey: "azure-key",
      providerSpecificData: {
        azureEndpoint: "https://example.services.ai.azure.com/api/projects/risk",
        authMode: "api-key",
      },
    }, { fetchFn, forceRefresh: true });

    expect(result.models).toContainEqual(expect.objectContaining({
      id: "risk-chat",
      upstreamModelName: "DeepSeek-V3",
    }));
  });
});

describe("AWS Bedrock live model catalog", () => {
  it("merges all active foundation models and paginated inference profiles", async () => {
    const fetchFn = vi.fn(async (url, options) => {
      expect(options.headers.Authorization).toContain("Credential=AKIDEXAMPLE/");
      expect(JSON.stringify(options.headers)).not.toContain("secret-key");
      if (url.endsWith("/foundation-models")) {
        return jsonResponse({ modelSummaries: [
          {
            modelId: "amazon.nova-pro-v1:0",
            modelName: "Amazon Nova Pro",
            providerName: "Amazon",
            outputModalities: ["TEXT"],
            modelLifecycle: { status: "ACTIVE" },
          },
          {
            modelId: "amazon.titan-embed-text-v2:0",
            modelName: "Titan Text Embeddings V2",
            outputModalities: ["EMBEDDING"],
            modelLifecycle: { status: "ACTIVE" },
          },
          {
            modelId: "retired.model",
            modelLifecycle: { status: "LEGACY" },
          },
        ] });
      }
      const parsed = new URL(url);
      if (!parsed.searchParams.has("nextToken")) {
        return jsonResponse({
          inferenceProfileSummaries: [{ inferenceProfileId: "us.amazon.nova-pro-v1:0", inferenceProfileName: "Nova Pro US" }],
          nextToken: "page two",
        });
      }
      return jsonResponse({
        inferenceProfileSummaries: [{ inferenceProfileId: "global.anthropic.claude-sonnet", type: "SYSTEM_DEFINED" }],
      });
    });

    const result = await resolveBedrockModels({
      id: "bedrock-test",
      apiKey: "AKIDEXAMPLE",
      providerSpecificData: {
        secretAccessKey: "secret-key",
        sessionToken: "session-token",
        region: "us-east-1",
      },
    }, { fetchFn, forceRefresh: true });

    expect(result.models.map((model) => model.id)).toEqual(expect.arrayContaining([
      "amazon.nova-pro-v1:0",
      "amazon.titan-embed-text-v2:0",
      "us.amazon.nova-pro-v1:0",
      "global.anthropic.claude-sonnet",
    ]));
    expect(result.models.map((model) => model.id)).not.toContain("retired.model");
    expect(result.models.find((model) => model.id === "amazon.titan-embed-text-v2:0")?.kind).toBe("embedding");
  });
});
