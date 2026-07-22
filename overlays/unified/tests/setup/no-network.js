// Unit and integration tests are offline by default. Real-provider suites must
// opt in explicitly with ALLOW_TEST_NETWORK=1 in addition to their own gate.
import http from "node:http";
import https from "node:https";
import http2 from "node:http2";
import net from "node:net";

if (process.env.ALLOW_TEST_NETWORK !== "1") {
  const BLOCKED = "[TEST_NETWORK_BLOCKED] External network access is disabled";
  const loopbackHosts = new Set(["localhost", "localhost.localdomain", "127.0.0.1", "::1", "[::1]"]);

  function isLoopback(host) {
    const value = String(host || "localhost").replace(/^\[|\]$/g, "").toLowerCase();
    return loopbackHosts.has(value) || value.startsWith("127.");
  }

  function urlHost(input) {
    try {
      if (input instanceof URL) return input.hostname;
      if (typeof input === "string") return new URL(input).hostname;
      return input?.hostname || input?.host || "localhost";
    } catch {
      return "external.invalid";
    }
  }

  function blocked(kind, host) {
    throw new Error(`${BLOCKED}: ${kind} ${host || "unknown"}`);
  }

  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async function offlineFetch(input, init) {
    const host = urlHost(input);
    if (!isLoopback(host)) return blocked("fetch", host);
    return nativeFetch(input, init);
  };

  function guardRequest(module, kind) {
    const originalRequest = module.request.bind(module);
    const originalGet = module.get.bind(module);
    module.request = function guardedRequest(input, ...args) {
      const host = urlHost(input);
      if (!isLoopback(host)) return blocked(kind, host);
      return originalRequest(input, ...args);
    };
    module.get = function guardedGet(input, ...args) {
      const host = urlHost(input);
      if (!isLoopback(host)) return blocked(kind, host);
      return originalGet(input, ...args);
    };
  }

  guardRequest(http, "http");
  guardRequest(https, "https");

  const nativeHttp2Connect = http2.connect.bind(http2);
  http2.connect = function guardedHttp2Connect(authority, ...args) {
    const host = urlHost(authority);
    if (!isLoopback(host)) return blocked("http2", host);
    return nativeHttp2Connect(authority, ...args);
  };

  const nativeSocketConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function guardedSocketConnect(...args) {
    const first = args[0];
    if (first && typeof first === "object" && first.path) {
      return nativeSocketConnect.apply(this, args);
    }
    const host = typeof first === "object" ? first.host : args[1];
    if (!isLoopback(host)) return blocked("tcp", host);
    return nativeSocketConnect.apply(this, args);
  };
}
