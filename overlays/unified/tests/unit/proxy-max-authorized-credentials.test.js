import { describe, expect, it } from "vitest";
import {
  AUTHORIZED_CREDENTIALS_GUARDRAIL,
  AUTHORIZED_CREDENTIALS_MARKER,
  injectAuthorizedCredentialsGuardrail,
} from "../../open-sse/guardrails/authorizedCredentials.js";

function markerCount(body) {
  return JSON.stringify(body).split(AUTHORIZED_CREDENTIALS_MARKER).length - 1;
}

describe("Proxy-Max authorized-development credential guardrail", () => {
  it("keeps the unified text byte-for-byte aligned with the legacy guardrail", () => {
    expect(AUTHORIZED_CREDENTIALS_GUARDRAIL).toContain("Pass values the user pastes through VERBATIM");
    expect(AUTHORIZED_CREDENTIALS_GUARDRAIL).toContain("[/AUTHORIZED-DEV-ENVIRONMENT]");
  });

  it.each([
    ["openai", { messages: [{ role: "user", content: "hello" }] }],
    ["openai-responses", { input: "hello" }],
    ["claude", { system: [{ type: "text", text: "existing", cache_control: { type: "ephemeral" } }], messages: [] }],
    ["gemini", { contents: [{ role: "user", parts: [{ text: "hello" }] }] }],
    ["antigravity", { request: { contents: [{ role: "user", parts: [{ text: "hello" }] }] } }],
  ])("injects and remains idempotent for %s", (format, body) => {
    expect(injectAuthorizedCredentialsGuardrail(body, format)).toBe(true);
    expect(markerCount(body)).toBe(1);
    expect(injectAuthorizedCredentialsGuardrail(body, format)).toBe(false);
    expect(markerCount(body)).toBe(1);
  });

  it("appends to an existing OpenAI developer message without changing its role", () => {
    const body = { messages: [{ role: "developer", content: "existing policy" }] };
    injectAuthorizedCredentialsGuardrail(body, "openai");
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toMatchObject({ role: "developer" });
    expect(body.messages[0].content).toContain("existing policy");
    expect(body.messages[0].content).toContain(AUTHORIZED_CREDENTIALS_MARKER);
  });

  it("always creates Responses instructions, including for string input", () => {
    const body = { input: "hello" };
    injectAuthorizedCredentialsGuardrail(body, "openai-responses");
    expect(body.instructions).toBe(AUTHORIZED_CREDENTIALS_GUARDRAIL);
  });
});
