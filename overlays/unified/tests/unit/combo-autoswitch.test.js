import { describe, it, expect } from "vitest";
import { detectRequiredCapabilities, reorderByCapabilities } from "../../open-sse/services/combo.js";

describe("detectRequiredCapabilities", () => {
  it("text-only -> empty", () => {
    const r = detectRequiredCapabilities({ messages: [{ role: "user", content: "hi" }] });
    expect(r.size).toBe(0);
  });

  it("openai image_url -> vision", () => {
    const r = detectRequiredCapabilities({ messages: [{ role: "user", content: [
      { type: "image_url", image_url: { url: "x" } },
    ] }] });
    expect(r.has("vision")).toBe(true);
  });

  it("openai file -> pdf", () => {
    const r = detectRequiredCapabilities({ messages: [{ role: "user", content: [
      { type: "file", file: { file_data: "data:application/pdf;base64,x" } },
    ] }] });
    expect(r.has("pdf")).toBe(true);
  });

  it("gemini inlineData image -> vision", () => {
    const r = detectRequiredCapabilities({ contents: [{ role: "user", parts: [
      { inlineData: { mimeType: "image/png", data: "x" } },
    ] }] });
    expect(r.has("vision")).toBe(true);
  });

  it("antigravity request.contents image -> vision", () => {
    const r = detectRequiredCapabilities({ request: { contents: [{ role: "user", parts: [
      { inlineData: { mimeType: "image/jpeg", data: "x" } },
    ] }] } });
    expect(r.has("vision")).toBe(true);
  });

  it("web_search tool -> search", () => {
    const r = detectRequiredCapabilities({ messages: [{ role: "user", content: "q" }], tools: [
      { type: "web_search" },
    ] });
    expect(r.has("search")).toBe(true);
  });

  it("responses input_image -> vision", () => {
    const r = detectRequiredCapabilities({ input: [{ role: "user", content: [
      { type: "input_image", image_url: "x" },
    ] }] });
    expect(r.has("vision")).toBe(true);
  });

  it("detects audio and video input across OpenAI and Gemini block shapes", () => {
    const openai = detectRequiredCapabilities({ messages: [{ role: "user", content: [
      { type: "input_audio", input_audio: { data: "x", format: "wav" } },
      { type: "input_video", video_url: { url: "https://example.test/v.mp4" } },
    ] }] });
    expect(openai).toEqual(new Set(["audioInput", "videoInput"]));

    const gemini = detectRequiredCapabilities({ contents: [{ role: "user", parts: [
      { inline_data: { mime_type: "audio/wav", data: "x" } },
      { file_data: { mime_type: "video/mp4", file_uri: "gs://bucket/v.mp4" } },
    ] }] });
    expect(gemini).toEqual(new Set(["audioInput", "videoInput"]));
  });

  it("detects Gemini grounding tools as search", () => {
    const r = detectRequiredCapabilities({
      contents: [{ role: "user", parts: [{ text: "latest news" }] }],
      tools: [{ googleSearch: {} }],
    });
    expect(r.has("search")).toBe(true);
  });
});

describe("reorderByCapabilities", () => {
  it("no required -> unchanged", () => {
    const models = ["a/x", "b/y"];
    expect(reorderByCapabilities(models, new Set())).toBe(models);
  });

  it("floats vision-capable model to front, keeps fallback", () => {
    // deepseek-chat = no vision; claude-sonnet = vision
    const models = ["deepseek/deepseek-chat", "anthropic/claude-sonnet-4.6"];
    const out = reorderByCapabilities(models, new Set(["vision"]));
    expect(out[0]).toBe("anthropic/claude-sonnet-4.6");
    expect(out).toContain("deepseek/deepseek-chat"); // not dropped
    expect(out).toHaveLength(2);
  });

  it("keeps order when no model matches", () => {
    const models = ["deepseek/deepseek-chat", "deepseek/deepseek-reasoner"];
    const out = reorderByCapabilities(models, new Set(["vision"]));
    expect(out).toBe(models);
  });

  it("single model -> unchanged", () => {
    const models = ["a/x"];
    expect(reorderByCapabilities(models, new Set(["vision"]))).toBe(models);
  });

  it("canonicalizes provider aliases before applying provider-specific capabilities", () => {
    const models = ["deepseek/deepseek-chat", "cbcn/minimax-m2.7"];
    const out = reorderByCapabilities(models, new Set(["vision"]));
    expect(out[0]).toBe("cbcn/minimax-m2.7");
  });
});
