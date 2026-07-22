import { describe, expect, it, vi } from "vitest";
import {
  proxyAwareFetch,
  proxyOptionsFromCredentials,
  runWithCredentialsProxy,
  runWithProxyOptions,
} from "../../open-sse/utils/proxyFetch.js";

describe("request-scoped proxy fetch context", () => {
  it("isolates concurrent raw fetch transports", async () => {
    const fetchA = vi.fn(async () => new Response("A"));
    const fetchB = vi.fn(async () => new Response("B"));

    const [a, b] = await Promise.all([
      runWithProxyOptions({ fetchFn: fetchA }, async () => {
        await Promise.resolve();
        return globalThis.fetch("https://provider-a.example/v1");
      }),
      runWithProxyOptions({ fetchFn: fetchB }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return globalThis.fetch("https://provider-b.example/v1");
      }),
    ]);

    await expect(a.text()).resolves.toBe("A");
    await expect(b.text()).resolves.toBe("B");
    expect(fetchA).toHaveBeenCalledOnce();
    expect(fetchA.mock.calls[0][0]).toBe("https://provider-a.example/v1");
    expect(fetchB).toHaveBeenCalledOnce();
    expect(fetchB.mock.calls[0][0]).toBe("https://provider-b.example/v1");
  });

  it("lets an explicit nested connection replace its parent policy", async () => {
    const outerFetch = vi.fn(async () => new Response("outer"));
    const innerFetch = vi.fn(async () => new Response("inner"));

    const values = await runWithProxyOptions({ fetchFn: outerFetch }, async () => {
      const outer = await proxyAwareFetch("https://outer.example");
      const inner = await runWithProxyOptions({ fetchFn: innerFetch }, () =>
        proxyAwareFetch("https://inner.example"),
      );
      const outerAgain = await proxyAwareFetch("https://outer-again.example");
      return Promise.all([outer.text(), inner.text(), outerAgain.text()]);
    });

    expect(values).toEqual(["outer", "inner", "outer"]);
    expect(outerFetch).toHaveBeenCalledTimes(2);
    expect(innerFetch).toHaveBeenCalledOnce();
  });

  it("normalizes only connection proxy fields from credentials", async () => {
    const options = proxyOptionsFromCredentials({
      providerSpecificData: {
        connectionProxyEnabled: true,
        connectionProxyUrl: "  http://proxy.internal:8080  ",
        connectionNoProxy: " localhost ",
        vercelRelayUrl: "  https://relay.example/proxy ",
        strictProxy: true,
        unrelatedSecret: "must-not-copy",
      },
    });

    expect(options).toEqual({
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.internal:8080",
      connectionNoProxy: "localhost",
      vercelRelayUrl: "https://relay.example/proxy",
      strictProxy: true,
    });

    const fetchFn = vi.fn(async () => new Response("ok"));
    const response = await runWithCredentialsProxy(
      { providerSpecificData: {}, ignored: "secret" },
      () => runWithProxyOptions({ fetchFn }, () => globalThis.fetch("https://safe.example")),
    );
    await expect(response.text()).resolves.toBe("ok");
  });

  it("fails closed when strict proxy policy has no resolved URL", async () => {
    const directFetch = vi.fn(async () => new Response("must not run"));

    await expect(
      proxyAwareFetch(
        "https://provider.example/v1",
        {},
        {
          connectionProxyEnabled: true,
          connectionProxyUrl: "",
          strictProxy: true,
          fetchFn: directFetch,
        },
      ),
    ).rejects.toThrow("no connection proxy URL is configured");
    expect(directFetch).not.toHaveBeenCalled();
  });
});
