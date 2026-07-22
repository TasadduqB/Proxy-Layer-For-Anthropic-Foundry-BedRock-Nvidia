import { describe, expect, it, vi } from "vitest";
import {
  assertPublicUrl,
  assertPublicUrlResolved,
  fetchUrlWithPolicy,
  isBlockedIpv4,
  isBlockedIpv6,
} from "@/shared/utils/ssrfGuard.js";

describe("Proxy-Max SSRF policy", () => {
  it("blocks private, metadata, reserved, mapped, and credentialed literals", () => {
    for (const url of [
      "http://127.0.0.1/", "http://169.254.169.254/latest/meta-data", "http://100.64.0.1/",
      "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://[fc00::1]/",
      "file:///etc/passwd", "https://user:pass@example.com/", "https://metadata.google.internal/",
    ]) expect(() => assertPublicUrl(url)).toThrow(/Blocked URL/);
    expect(isBlockedIpv4("198.18.0.1")).toBe(true);
    expect(isBlockedIpv6("::ffff:10.0.0.1")).toBe(true);
    expect(() => assertPublicUrl("https://8.8.8.8/")).not.toThrow();
  });

  it("rejects a public hostname if any DNS answer is private", async () => {
    const lookup = vi.fn(async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    await expect(assertPublicUrlResolved("https://public.example.org/", { lookup })).rejects.toThrow(/private or reserved/);
  });

  it("revalidates redirects and never follows one into metadata", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "https://169.254.169.254/latest/meta-data" },
    }));
    const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
    await expect(fetchUrlWithPolicy("https://public.example.org/start", {}, { fetchImpl, lookup }))
      .rejects.toThrow(/private or reserved/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects HTTPS downgrade redirects", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "http://public.example.org/final" },
    }));
    const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
    await expect(fetchUrlWithPolicy("https://public.example.org/start", {}, { fetchImpl, lookup }))
      .rejects.toThrow(/HTTPS downgrade/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("pins the transport to the exact DNS answers that passed validation", async () => {
    const dispatcher = { dispatch() {} };
    const dispatcherFactory = vi.fn(() => dispatcher);
    const fetchImpl = vi.fn(async (_url, options) => {
      expect(options.dispatcher).toBe(dispatcher);
      return new Response("ok", { status: 200 });
    });
    const addresses = [{ address: "93.184.216.34", family: 4 }];
    const lookup = vi.fn(async () => addresses);

    await fetchUrlWithPolicy("https://public.example.org/data", {}, {
      fetchImpl,
      lookup,
      dispatcherFactory,
    });

    expect(dispatcherFactory).toHaveBeenCalledWith(expect.any(URL), addresses);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("strips credentials on cross-origin redirects", async () => {
    const seen = [];
    const fetchImpl = vi.fn(async (url, options) => {
      seen.push({ url: String(url), headers: new Headers(options.headers) });
      if (seen.length === 1) return new Response(null, { status: 302, headers: { location: "https://other.example.net/final" } });
      return new Response("ok", { status: 200 });
    });
    const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
    const response = await fetchUrlWithPolicy("https://public.example.org/start", {
      headers: { authorization: "Bearer secret", "x-api-key": "secret-key", accept: "application/json" },
    }, { fetchImpl, lookup });
    expect(response.status).toBe(200);
    expect(seen[1].headers.has("authorization")).toBe(false);
    expect(seen[1].headers.has("x-api-key")).toBe(false);
    expect(seen[1].headers.get("accept")).toBe("application/json");
  });
});
