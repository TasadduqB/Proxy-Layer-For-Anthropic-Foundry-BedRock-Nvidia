import { describe, expect, it } from "vitest";

import {
  CONTEXT_COMPRESSION_PLUGIN_ID,
  enableOpenRouterContextCompression,
  isDeterministicContextError,
  isDeterministicOpenRouterRequestError,
  normalizeOpenRouterToolSchemas,
} from "../../open-sse/utils/openRouterRequest.js";

describe("OpenRouter context compression", () => {
  it("enables native context compression for OpenRouter chat requests", () => {
    const body = { messages: [{ role: "user", content: "hello" }] };

    expect(enableOpenRouterContextCompression("openrouter", body)).toBe(true);
    expect(body.plugins).toEqual([{ id: CONTEXT_COMPRESSION_PLUGIN_ID }]);
  });

  it("preserves other plugins and does not add duplicates", () => {
    const body = {
      plugins: [{ id: "response-healing" }, { id: CONTEXT_COMPRESSION_PLUGIN_ID }],
    };

    expect(enableOpenRouterContextCompression("openrouter", body)).toBe(false);
    expect(body.plugins).toHaveLength(2);
  });

  it("respects an explicitly disabled context-compression plugin", () => {
    const body = {
      plugins: [{ id: CONTEXT_COMPRESSION_PLUGIN_ID, enabled: false }],
    };

    expect(enableOpenRouterContextCompression("openrouter", body)).toBe(false);
    expect(body.plugins[0].enabled).toBe(false);
  });

  it("does not modify another provider's request", () => {
    const body = { messages: [] };

    expect(enableOpenRouterContextCompression("opencode", body)).toBe(false);
    expect(body).not.toHaveProperty("plugins");
  });

  it("classifies context overflow as a deterministic request error", () => {
    expect(isDeterministicContextError(
      400,
      "This endpoint's maximum context length is 262144 tokens. You requested about 362616 tokens.",
    )).toBe(true);
    expect(isDeterministicContextError(429, "rate limit exceeded")).toBe(false);
    expect(isDeterministicContextError(502, "fetch timeout")).toBe(false);
  });

  it("classifies unsupported tool schemas without blaming the credential", () => {
    expect(isDeterministicOpenRouterRequestError(
      422,
      "auto tool schemas do not support dependency, property-name, or unevaluated assertions",
    )).toBe(true);
    expect(isDeterministicOpenRouterRequestError(401, "invalid api key")).toBe(false);
    expect(isDeterministicOpenRouterRequestError(429, "rate limit exceeded")).toBe(false);
  });

  it("removes schema assertions rejected by OpenRouter tool backends", () => {
    const body = {
      tools: [{
        type: "function",
        function: {
          name: "Agent",
          parameters: {
            type: "object",
            propertyNames: { pattern: "^[a-z]+$" },
            unevaluatedProperties: false,
            properties: {
              prompt: {
                type: "object",
                dependentRequired: { task: ["context"] },
              },
            },
          },
        },
      }],
    };

    expect(normalizeOpenRouterToolSchemas("openrouter", body)).toBe(3);
    expect(JSON.stringify(body)).not.toContain("propertyNames");
    expect(JSON.stringify(body)).not.toContain("unevaluatedProperties");
    expect(JSON.stringify(body)).not.toContain("dependentRequired");
  });
});
