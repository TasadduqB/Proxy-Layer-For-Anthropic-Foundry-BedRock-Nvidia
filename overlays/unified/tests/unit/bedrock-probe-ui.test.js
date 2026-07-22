import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  buildBedrockProbe,
  classifyBedrockProbeResponse,
  probeBedrockConnection,
} from "../../src/lib/providers/bedrockProbe.js";
import { buildBedrockProviderSpecificData } from "../../src/lib/providers/bedrockForm.js";
import { MASKED_VALUE, mergeMaskedSecrets } from "../../src/lib/security/redact.js";

describe("shared AWS Bedrock validation probe", () => {
  it("uses the runtime SigV4 path and a minimal native Anthropic request", () => {
    const probe = buildBedrockProbe({
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: "secret-access-key",
      sessionToken: "session-token",
      region: "eu-west-1",
      endpoint: "https://bedrock.internal.example/root",
      model: "anthropic.claude-3-haiku-20240307-v1:0",
      now: new Date("2026-07-21T00:00:00.000Z"),
    });
    expect(probe.url).toBe(
      "https://bedrock.internal.example/root/model/anthropic.claude-3-haiku-20240307-v1%3A0/invoke",
    );
    expect(probe.url).not.toContain("AKIDEXAMPLE");
    expect(probe.url).not.toContain("secret-access-key");
    expect(probe.options.headers.Authorization).toContain("Credential=AKIDEXAMPLE/");
    expect(probe.options.headers["X-Amz-Security-Token"]).toBe("session-token");
    expect(probe.options.headers["X-Amzn-Bedrock-Accept"]).toBe("application/json");
    expect(JSON.parse(probe.options.body)).toEqual({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 1,
      messages: [{ role: "user", content: [{ type: "text", text: "test" }] }],
    });
  });

  it("distinguishes AWS credential failures from authenticated validation errors", async () => {
    await expect(classifyBedrockProbeResponse(new Response(JSON.stringify({
      __type: "com.amazon.coral.service#UnrecognizedClientException",
    }), { status: 400 }))).resolves.toMatchObject({ valid: false, status: 400 });

    await expect(classifyBedrockProbeResponse(new Response(JSON.stringify({
      __type: "ValidationException",
    }), { status: 400 }))).resolves.toEqual({ valid: true, error: null, status: 400 });

    await expect(classifyBedrockProbeResponse(new Response("denied", { status: 403 }))).resolves.toMatchObject({
      valid: false,
      status: 403,
    });
    await expect(classifyBedrockProbeResponse(new Response("not an AWS response", { status: 404 }))).resolves.toEqual({
      valid: false,
      error: "AWS Bedrock validation failed",
      status: 404,
    });
  });

  it("passes request-scoped proxy options to an injected fetch and sanitizes failures", async () => {
    const proxyOptions = { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.test:8080", strictProxy: true };
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ __type: "ValidationException" }), { status: 400 }));
    const result = await probeBedrockConnection({
      accessKeyId: "AKIDEXAMPLE",
      providerSpecificData: { secretAccessKey: "secret", region: "us-east-1" },
      fetchImpl,
      fetchProxyOptions: proxyOptions,
      now: new Date("2026-07-21T00:00:00.000Z"),
    });
    expect(result.valid).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][2]).toBe(proxyOptions);

    const failed = await probeBedrockConnection({
      accessKeyId: "AKIDEXAMPLE",
      providerSpecificData: { secretAccessKey: "secret", endpoint: "https://private.example" },
      fetchImpl: vi.fn().mockRejectedValue(new Error("secret at https://private.example")),
    });
    expect(failed).toEqual({
      valid: false,
      error: "Unable to validate AWS Bedrock configuration",
      status: 0,
    });
  });
});

describe("AWS Bedrock dashboard and route contracts", () => {
  const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const read = (relative) => fs.readFileSync(path.join(runtimeRoot, relative), "utf8");

  it("collects all four AWS credential/configuration fields in add and edit modals", () => {
    const add = read("src/app/(dashboard)/dashboard/providers/[id]/AddApiKeyModal.js");
    const edit = read("src/shared/components/EditConnectionModal.js");
    for (const source of [add, edit]) {
      expect(source).toContain("AWS Access Key ID");
      expect(source).toContain("AWS Secret Access Key");
      expect(source).toContain("AWS Session Token (optional)");
      expect(source).toContain("Custom Bedrock Endpoint (optional)");
      expect(source).toContain("secretAccessKey");
      expect(source).toContain("sessionToken");
      expect(source).toContain("endpoint");
      expect(source).toContain("region");
    }
    expect(edit).toContain("containsMaskedValue");
    expect(edit).toContain("Clear the saved session token when saving");
  });

  it("preserves masked secrets by default but explicitly clears a stale session token", () => {
    const existing = { secretAccessKey: "stored-secret", sessionToken: "stored-session", region: "us-east-1" };
    const preservedPayload = buildBedrockProviderSpecificData({
      secretAccessKey: MASKED_VALUE,
      sessionToken: MASKED_VALUE,
      region: "us-west-2",
    });
    expect(mergeMaskedSecrets(preservedPayload, existing)).toMatchObject({
      secretAccessKey: "stored-secret",
      sessionToken: "stored-session",
      region: "us-west-2",
    });

    const clearedPayload = buildBedrockProviderSpecificData({
      secretAccessKey: "",
      sessionToken: MASKED_VALUE,
      clearSessionToken: true,
      region: "us-west-2",
    });
    expect(clearedPayload).not.toHaveProperty("secretAccessKey");
    expect(mergeMaskedSecrets(clearedPayload, existing)).toMatchObject({
      secretAccessKey: "stored-secret",
      sessionToken: "",
      region: "us-west-2",
    });
  });

  it("wires both validation routes through the shared Bedrock probe and masks client secrets", () => {
    const validate = read("src/app/api/providers/validate/route.js");
    const savedTest = read("src/app/api/providers/[id]/test/testUtils.js");
    const clientRoute = read("src/app/api/providers/client/route.js");
    const createRoute = read("src/app/api/providers/route.js");
    const updateRoute = read("src/app/api/providers/[id]/route.js");
    expect(validate).toContain("probeBedrockConnection");
    expect(validate).toContain("proxyAwareFetch");
    expect(validate).toContain("resolveConnectionProxyConfig");
    expect(savedTest).toContain("probeBedrockConnection");
    expect(savedTest).toContain("fetchWithConnectionProxy");
    expect(clientRoute).toContain('"secretAccessKey"');
    expect(clientRoute).toContain('"sessionToken"');
    expect(clientRoute).toContain("redactCredentialObject");
    expect(createRoute).toContain("normalizeBedrockProviderSpecificData");
    expect(updateRoute).toContain("normalizeBedrockProviderSpecificData");
    expect(updateRoute).toContain("mergeMaskedSecrets");
  });
});
