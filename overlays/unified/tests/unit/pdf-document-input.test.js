import { describe, expect, it, vi } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { detectRequiredCapabilities, reorderByCapabilities } from "../../open-sse/services/combo.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { convertOpenAIContentToParts } from "../../open-sse/translator/formats/gemini.js";
import { convertResponsesApiFormat } from "../../open-sse/translator/formats/responsesApi.js";
import { prefetchRemoteDocuments } from "../../open-sse/translator/concerns/prefetch.js";
import { claudeToOpenAIRequest } from "../../open-sse/translator/request/claude-to-openai.js";
import { geminiToOpenAIRequest } from "../../open-sse/translator/request/gemini-to-openai.js";
import {
  openaiResponsesToOpenAIRequest,
  openaiToOpenAIResponsesRequest,
} from "../../open-sse/translator/request/openai-responses.js";

const PDF_B64 = "JVBERi0xLjcKJSVFT0Y=";
const PDF_URI = `data:application/pdf;base64,${PDF_B64}`;

describe("PDF capability routing", () => {
  it("enables PDF only for model + transport combinations that preserve documents", () => {
    expect(getCapabilitiesForModel("anthropic", "claude-sonnet-4-20250514").pdf).toBe(true);
    expect(getCapabilitiesForModel("gemini", "gemini-2.5-pro").pdf).toBe(true);
    expect(getCapabilitiesForModel("vertex", "gemini-3.1-pro-preview").pdf).toBe(true);
    expect(getCapabilitiesForModel("openai", "gpt-4.1").pdf).toBe(true);

    // Same model name over a transport that has no document representation.
    expect(getCapabilitiesForModel("kiro", "claude-sonnet-4.6").pdf).toBe(false);
    expect(getCapabilitiesForModel("cursor", "gpt-5").pdf).toBe(false);
    expect(getCapabilitiesForModel("deepseek", "deepseek-chat").pdf).toBe(false);
  });

  it("detects Responses/Gemini PDF blocks and promotes a lossless combo target", () => {
    expect(detectRequiredCapabilities({ input: [{ role: "user", content: [
      { type: "input_file", filename: "report.pdf", file_data: PDF_URI },
    ] }] })).toContain("pdf");
    expect(detectRequiredCapabilities({ contents: [{ role: "user", parts: [
      { inline_data: { mime_type: "application/pdf", data: PDF_B64 } },
    ] }] })).toContain("pdf");

    const models = ["kiro/claude-sonnet-4.6", "anthropic/claude-sonnet-4-20250514"];
    expect(reorderByCapabilities(models, new Set(["pdf"]))[0]).toBe("anthropic/claude-sonnet-4-20250514");
  });
});

describe("PDF request translation", () => {
  it("preserves a Claude base64 document through the OpenAI pivot", () => {
    const out = claudeToOpenAIRequest("gpt-5", {
      messages: [{ role: "user", content: [{
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: PDF_B64 },
      }] }],
    }, false);
    expect(out.messages[0].content).toContainEqual({
      type: "file",
      file: { mime_type: "application/pdf", file_data: PDF_URI },
    });
  });

  it("distinguishes Gemini PDFs from images for camelCase and snake_case inputs", () => {
    for (const part of [
      { inlineData: { mimeType: "application/pdf", data: PDF_B64 } },
      { inline_data: { mime_type: "application/pdf", data: PDF_B64 } },
    ]) {
      const out = geminiToOpenAIRequest("gpt-5", {
        contents: [{ role: "user", parts: [{ text: "summarize" }, part] }],
      }, false);
      expect(out.messages[0].content).toContainEqual({
        type: "file",
        file: { mime_type: "application/pdf", file_data: PDF_URI },
      });
      expect(out.messages[0].content.some((block) => block.type === "image_url")).toBe(false);
    }
  });

  it("maps an OpenAI PDF to canonical Gemini inlineData", () => {
    expect(convertOpenAIContentToParts([
      { type: "file", file: { filename: "report.pdf", file_data: PDF_URI } },
    ])).toContainEqual({ inlineData: { mimeType: "application/pdf", data: PDF_B64 } });
  });

  it("round-trips Responses input_file without serializing it into text", () => {
    const responses = {
      input: [{ type: "message", role: "user", content: [
        { type: "input_text", text: "summarize" },
        { type: "input_file", filename: "report.pdf", file_data: PDF_URI },
      ] }],
    };
    const chat = openaiResponsesToOpenAIRequest("gpt-5", responses, false);
    expect(chat.messages[0].content).toContainEqual({
      type: "file",
      file: { filename: "report.pdf", mime_type: "application/pdf", file_data: PDF_URI },
    });
    expect(convertResponsesApiFormat(responses).messages[0].content).toContainEqual({
      type: "file",
      file: { filename: "report.pdf", mime_type: "application/pdf", file_data: PDF_URI },
    });

    const roundTrip = openaiToOpenAIResponsesRequest("gpt-5", chat, true);
    expect(roundTrip.input[0].content).toContainEqual({
      type: "input_file",
      filename: "report.pdf",
      file_data: PDF_URI,
    });
  });
});

describe("remote PDF prefetch", () => {
  const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);

  it("inlines a verified, bounded PDF without live network access", async () => {
    const fetchImpl = vi.fn(async () => new Response(Buffer.from("%PDF-1.7\n%%EOF"), {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    }));
    const body = { messages: [{ role: "user", content: [
      { type: "file", file: { filename: "report.pdf", file_data: "https://cdn.cloudflare.com/report.pdf" } },
    ] }] };

    await expect(prefetchRemoteDocuments(body, FORMATS.OPENAI, FORMATS.GEMINI, {
      fetchImpl,
      lookup,
    })).resolves.toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(body.messages[0].content[0].file.file_data).toMatch(/^data:application\/pdf;base64,/);
  });

  it("rejects SSRF targets before invoking fetch", async () => {
    const fetchImpl = vi.fn();
    const body = { messages: [{ role: "user", content: [
      { type: "file", file: { filename: "report.pdf", file_data: "http://127.0.0.1/report.pdf" } },
    ] }] };
    await expect(prefetchRemoteDocuments(body, FORMATS.OPENAI, FORMATS.GEMINI, {
      fetchImpl,
      lookup,
    })).rejects.toThrow(/Blocked URL/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects disguised and oversized remote files", async () => {
    const baseBody = () => ({ messages: [{ role: "user", content: [
      { type: "file", file: { filename: "report.pdf", file_data: "https://cdn.cloudflare.com/report.pdf" } },
    ] }] });
    await expect(prefetchRemoteDocuments(baseBody(), FORMATS.OPENAI, FORMATS.GEMINI, {
      fetchImpl: async () => new Response("not a pdf", { status: 200 }),
      lookup,
    })).rejects.toThrow(/not a PDF/);
    await expect(prefetchRemoteDocuments(baseBody(), FORMATS.OPENAI, FORMATS.GEMINI, {
      fetchImpl: async () => new Response("%PDF-1.7", { status: 200, headers: { "content-length": "100" } }),
      lookup,
      maxBytes: 8,
    })).rejects.toThrow(/size limit/);
  });
});
