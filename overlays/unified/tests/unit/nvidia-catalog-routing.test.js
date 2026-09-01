import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async () => []),
}));

import nvidiaProvider from "../../open-sse/providers/registry/nvidia.js";
import {
  NVIDIA_CHAT_COMPLETIONS_URL,
  NVIDIA_EMBEDDINGS_URL,
  NVIDIA_HOSTED_MODELS,
  NVIDIA_IMAGE_GENERATIONS_URL,
  NVIDIA_MODELS_URL,
  classifyNvidiaModel,
} from "../../open-sse/providers/registry/nvidiaModels.js";
import {
  clearNvidiaCatalogCache,
  getNvidiaCatalogEntries,
  getNvidiaCatalogSource,
  isNvidiaChatModelId,
  isNvidiaClaudeAutoModelId,
  isNvidiaClaudeToolModelId,
} from "@/lib/nvidiaCatalog.js";

describe("NVIDIA hosted catalog routing", () => {
  beforeEach(() => {
    clearNvidiaCatalogCache();
    vi.unstubAllGlobals();
  });

  it("keeps a complete classified fallback for the current hosted catalog", () => {
    expect(NVIDIA_HOSTED_MODELS).toHaveLength(102);
    expect(NVIDIA_HOSTED_MODELS.filter((model) => model.kind === "embedding")).toHaveLength(13);
    expect(NVIDIA_HOSTED_MODELS.filter((model) => model.kind === "llm")).toHaveLength(88);
    expect(NVIDIA_HOSTED_MODELS.filter((model) => model.kind === "unsupported")).toEqual([
      expect.objectContaining({
        id: "nvidia/ai-synthetic-video-detector",
        protocol: "grpc",
        routable: false,
      }),
    ]);
  });

  it("routes every supported service kind to NVIDIA's actual hosted endpoint", () => {
    expect(classifyNvidiaModel("nvidia/nv-embed-v1")).toMatchObject({
      kind: "embedding",
      endpoint: NVIDIA_EMBEDDINGS_URL,
      routable: true,
    });
    expect(classifyNvidiaModel("black-forest-labs/flux.1-dev")).toMatchObject({
      kind: "image",
      endpoint: NVIDIA_IMAGE_GENERATIONS_URL,
      routable: true,
    });
    expect(classifyNvidiaModel("google/diffusiongemma-26b-a4b-it")).toMatchObject({
      kind: "llm",
      endpoint: NVIDIA_CHAT_COMPLETIONS_URL,
      routable: true,
    });
  });

  it.each([
    "meta/llama-guard-4-12b",
    "nvidia/nemoretriever-parse",
    "nvidia/nemotron-parse",
    "nvidia/nemotron-3.5-content-safety",
    "google/diffusiongemma-26b-a4b-it",
    "nvidia/riva-translate-4b-instruct-v2",
  ])("keeps NVIDIA chat-compatible specialist %s on chat without auto-promoting it to Claude", (model) => {
    expect(isNvidiaChatModelId(model)).toBe(true);
    expect(isNvidiaClaudeAutoModelId(model)).toBe(false);
  });

  it.each([
    "meta/llama-guard-4-12b",
    "nvidia/nemoretriever-parse",
    "nvidia/nemotron-parse",
    "nvidia/nemotron-3.5-content-safety",
    "nvidia/riva-translate-4b-instruct-v2",
  ])("keeps narrow specialist %s out of the broad Claude tool candidates", (model) => {
    expect(isNvidiaClaudeToolModelId(model)).toBe(false);
  });

  it("does not advertise obsolete NVIDIA audio routes", () => {
    expect(nvidiaProvider.transport).toMatchObject({
      baseUrl: NVIDIA_CHAT_COMPLETIONS_URL,
      validateUrl: NVIDIA_MODELS_URL,
    });
    expect(nvidiaProvider.serviceKinds).toEqual(["llm", "embedding", "image"]);
    expect(nvidiaProvider.embeddingConfig.baseUrl).toBe(NVIDIA_EMBEDDINGS_URL);
    expect(nvidiaProvider.imageConfig.baseUrl).toBe(NVIDIA_IMAGE_GENERATIONS_URL);
    expect(nvidiaProvider).not.toHaveProperty("ttsConfig");
    expect(nvidiaProvider).not.toHaveProperty("sttConfig");
  });

  it("refreshes the public catalog without requiring or leaking an API key", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      object: "list",
      data: [
        { id: "meta/llama-3.3-70b-instruct", object: "model", owned_by: "meta" },
        { id: "nvidia/nv-embed-v1", object: "model", owned_by: "nvidia" },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getNvidiaCatalogEntries()).resolves.toEqual([
      expect.objectContaining({ id: "meta/llama-3.3-70b-instruct", kind: "llm" }),
      expect.objectContaining({ id: "nvidia/nv-embed-v1", kind: "embedding" }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(NVIDIA_MODELS_URL, expect.objectContaining({
      headers: {},
      cache: "no-store",
    }));
    expect(getNvidiaCatalogSource()).toBe("live");
  });

  it("falls back to the full snapshot when NVIDIA catalog discovery is down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("catalog timeout"); }));
    await expect(getNvidiaCatalogEntries()).resolves.toHaveLength(102);
    expect(getNvidiaCatalogSource()).toBe("snapshot");
  });
});
