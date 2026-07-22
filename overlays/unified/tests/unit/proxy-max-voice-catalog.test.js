import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderCredentials: vi.fn(),
  fetchEdgeTtsVoices: vi.fn(),
  fetchElevenLabsVoices: vi.fn(),
  fetchGeminiVoices: vi.fn(),
  fetchLocalDeviceVoices: vi.fn(),
  runWithCredentialsProxy: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
}));

vi.mock("@/shared/constants/providers", () => ({
  AI_PROVIDERS: {
    elevenlabs: { alias: "el" },
    deepgram: { alias: "dg" },
    inworld: { alias: "inworld" },
    "edge-tts": { alias: "edge-tts" },
    "local-device": { alias: "local-device" },
    gemini: { alias: "g" },
  },
}));

vi.mock("open-sse/handlers/ttsProviders/index.js", () => ({
  fetchEdgeTtsVoices: mocks.fetchEdgeTtsVoices,
  fetchElevenLabsVoices: mocks.fetchElevenLabsVoices,
  fetchGeminiVoices: mocks.fetchGeminiVoices,
  fetchLocalDeviceVoices: mocks.fetchLocalDeviceVoices,
}));

vi.mock("open-sse/utils/proxyFetch.js", () => ({
  runWithCredentialsProxy: mocks.runWithCredentialsProxy,
}));

const {
  getSupportedVoiceProviders,
  getVoiceCatalog,
  toOpenAiVoiceList,
  VoiceCatalogError,
} = await import("../../src/lib/tts/voiceCatalog.js");

describe("shared voice catalogue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderCredentials.mockResolvedValue({
      apiKey: "provider-secret",
      connectionId: "conn-1",
      providerSpecificData: {
        connectionProxyEnabled: true,
        connectionProxyUrl: "http://proxy.internal:8080",
        strictProxy: true,
      },
    });
    mocks.runWithCredentialsProxy.mockImplementation((_credentials, callback) =>
      callback(),
    );
    vi.stubGlobal("fetch", mocks.fetch);
  });

  it("exposes every legacy voice-list provider plus Gemini", () => {
    expect(getSupportedVoiceProviders()).toEqual(expect.arrayContaining([
      "elevenlabs",
      "deepgram",
      "inworld",
      "edge-tts",
      "local-device",
      "gemini",
    ]));
  });

  it("uses selected connection credentials and preserves multilingual voices", async () => {
    mocks.fetchElevenLabsVoices.mockResolvedValue([{
      voice_id: "voice-1",
      name: "Ava",
      category: "premade",
      labels: { language: "en", gender: "Female" },
      verified_languages: [{ language: "es" }],
    }]);

    const catalog = await getVoiceCatalog("elevenlabs");
    const openAiList = toOpenAiVoiceList("elevenlabs", catalog);

    expect(mocks.getProviderCredentials).toHaveBeenCalledWith("elevenlabs");
    expect(mocks.fetchElevenLabsVoices).toHaveBeenCalledWith("provider-secret");
    expect(mocks.runWithCredentialsProxy).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: "conn-1" }),
      expect.any(Function),
    );
    expect(catalog.byLang.en.voices[0]).toMatchObject({
      id: "voice-1",
      free_users_allowed: true,
    });
    expect(catalog.byLang.es.voices[0].id).toBe("voice-1");
    expect(openAiList).toEqual([expect.objectContaining({
      id: "voice-1",
      model: "el/voice-1",
      languages: ["en", "es"],
    })]);
  });

  it("normalizes Deepgram voices without putting credentials in the URL", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({
      tts: [{
        canonical_name: "aura-2-thalia-en",
        name: "Thalia",
        languages: ["en"],
        metadata: { tags: ["feminine"] },
      }],
    }), { status: 200 }));

    const catalog = await getVoiceCatalog("deepgram");

    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://api.deepgram.com/v1/models",
      expect.objectContaining({
        headers: { Authorization: "Token provider-secret" },
      }),
    );
    expect(catalog.voices).toEqual([expect.objectContaining({
      id: "aura-2-thalia-en",
      gender: "feminine",
    })]);
  });

  it("does not echo an upstream error body or connection secret", async () => {
    mocks.fetch.mockResolvedValue(new Response(
      "provider-secret should never escape",
      { status: 401 },
    ));

    await expect(getVoiceCatalog("inworld")).rejects.toMatchObject({
      message: "Inworld voice catalogue request failed (401)",
      status: 502,
    });
  });

  it("lists local voices without requesting stored credentials", async () => {
    mocks.fetchLocalDeviceVoices.mockResolvedValue([{
      id: "Samantha",
      name: "Samantha",
      locale: "en_US",
      lang: "en",
      country: "US",
      gender: "Female",
    }]);

    const catalog = await getVoiceCatalog("local-device");

    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
    expect(catalog.voices[0]).toMatchObject({
      id: "Samantha",
      locale: "en-US",
      country: "US",
    });
  });

  it("returns a typed client error when a provider has no connection", async () => {
    mocks.getProviderCredentials.mockResolvedValue(null);

    await expect(getVoiceCatalog("elevenlabs")).rejects.toEqual(
      expect.objectContaining({
        name: "VoiceCatalogError",
        status: 400,
      }),
    );
    expect(VoiceCatalogError.prototype).toBeInstanceOf(Error);
  });
});
