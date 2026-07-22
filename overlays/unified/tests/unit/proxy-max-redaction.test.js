import { describe, expect, it } from "vitest";
import {
  MASKED_VALUE,
  containsMaskedValue,
  maskUrlCredentials,
  mergeMaskedSecrets,
  redactCredentialObject,
} from "@/lib/security/redact.js";

describe("Proxy-Max API redaction", () => {
  it("masks nested credentials and URL userinfo/query secrets", () => {
    const safe = redactCredentialObject({
      apiKey: "top-secret",
      providerSpecificData: {
        clientSecret: "nested-secret",
        baseUrl: "https://user:pass@example.test/v1?api_key=query-secret&region=us",
      },
      usage: { inputTokens: 12 },
    });
    expect(safe.apiKey).toBe(MASKED_VALUE);
    expect(safe.providerSpecificData.clientSecret).toBe(MASKED_VALUE);
    expect(decodeURIComponent(safe.providerSpecificData.baseUrl)).not.toContain("user");
    expect(decodeURIComponent(safe.providerSpecificData.baseUrl)).not.toContain("query-secret");
    expect(safe.usage.inputTokens).toBe(12);
  });

  it("preserves stored values when a masked API round-trip is submitted", () => {
    const existing = {
      apiKey: "keep-key",
      providerSpecificData: { proxyUrl: "http://real:password@proxy.test", region: "old" },
    };
    const incoming = {
      apiKey: MASKED_VALUE,
      providerSpecificData: { proxyUrl: maskUrlCredentials(existing.providerSpecificData.proxyUrl), region: "new" },
    };
    expect(containsMaskedValue(incoming.providerSpecificData.proxyUrl)).toBe(true);
    expect(mergeMaskedSecrets(incoming, existing)).toEqual({
      apiKey: "keep-key",
      providerSpecificData: { proxyUrl: "http://real:password@proxy.test", region: "new" },
    });
  });
});
