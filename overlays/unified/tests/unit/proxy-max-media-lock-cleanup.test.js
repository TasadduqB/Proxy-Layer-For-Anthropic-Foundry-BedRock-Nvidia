import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  extractApiKey: vi.fn(() => null),
  isValidApiKey: vi.fn(async () => true),
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(async () => ({ shouldFallback: true })),
  clearAccountError: vi.fn(async () => {}),
}));

const cores = vi.hoisted(() => ({
  tts: vi.fn(),
  stt: vi.fn(),
}));

vi.mock("@/sse/services/auth.js", () => auth);
vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(async () => ({ requireApiKey: false })),
}));
vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: vi.fn(async () => ({ provider: "openai", model: "media-model" })),
  getComboModels: vi.fn(async () => null),
}));
vi.mock("@/shared/constants/providers", () => ({
  AI_PROVIDERS: {
    openai: {
      serviceKinds: ["tts", "stt"],
      noAuth: false,
      ttsConfig: { authType: "bearer" },
      sttConfig: { authType: "bearer", format: "openai" },
    },
  },
}));
vi.mock("open-sse/handlers/ttsCore.js", () => ({ handleTtsCore: cores.tts }));
vi.mock("open-sse/handlers/sttCore.js", () => ({ handleSttCore: cores.stt }));
vi.mock("open-sse/services/combo.js", () => ({ handleComboChat: vi.fn() }));
vi.mock("@/sse/utils/logger.js", () => ({
  request: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

import { handleTts } from "@/sse/handlers/tts.js";
import { handleStt } from "@/sse/handlers/stt.js";

const credentials = {
  connectionId: "media-connection",
  connectionName: "Media account",
  accessToken: "token",
  _connection: { id: "media-connection" },
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.getProviderCredentials.mockResolvedValue(credentials);
  cores.tts.mockResolvedValue({ success: true, response: new Response("audio") });
  cores.stt.mockResolvedValue({
    success: true,
    response: Response.json({ text: "transcript" }),
  });
});

describe("media account lock cleanup", () => {
  it("clears an expired TTS model lock after a successful credentialed request", async () => {
    const request = new Request("http://localhost/v1/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai/media-model", input: "hello" }),
    });

    const response = await handleTts(request);

    expect(response.status).toBe(200);
    expect(auth.clearAccountError).toHaveBeenCalledWith(
      "media-connection",
      credentials,
      "media-model"
    );
  });

  it("clears an expired STT model lock after a successful credentialed request", async () => {
    const form = new FormData();
    form.set("model", "openai/media-model");
    form.set("file", new File(["audio"], "sample.wav", { type: "audio/wav" }));
    const request = new Request("http://localhost/v1/audio/transcriptions", {
      method: "POST",
      body: form,
    });

    const response = await handleStt(request);

    expect(response.status).toBe(200);
    expect(auth.clearAccountError).toHaveBeenCalledWith(
      "media-connection",
      credentials,
      "media-model"
    );
  });
});
