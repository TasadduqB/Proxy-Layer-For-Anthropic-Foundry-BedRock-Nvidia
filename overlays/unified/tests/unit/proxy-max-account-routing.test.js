import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getProviderConnectionById: vi.fn(),
  validateApiKey: vi.fn(),
  updateProviderConnection: vi.fn(),
  getSettings: vi.fn(),
  getProxyPools: vi.fn(),
}));

const proxy = vi.hoisted(() => ({
  resolveConnectionProxyConfig: vi.fn(),
  pickProxyPoolId: vi.fn(),
}));

vi.mock("@/lib/localDb", () => db);
vi.mock("@/lib/network/connectionProxy", () => proxy);
vi.mock("@/shared/constants/providers.js", () => ({
  resolveProviderId: (provider) => provider,
  FREE_PROVIDERS: {},
}));
vi.mock("@/sse/utils/logger.js", () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

import {
  clearAccountError,
  getProviderCredentials,
} from "@/sse/services/auth.js";
import {
  getRelevantModelLockUntil,
  isModelLockActive,
} from "open-sse/services/accountFallback.js";

const NOW = new Date("2026-07-21T12:00:00.000Z");
const isoAfter = (milliseconds) => new Date(NOW.getTime() + milliseconds).toISOString();

function connection(id, overrides = {}) {
  return {
    id,
    provider: "openai",
    authType: "apikey",
    name: id,
    priority: 1,
    isActive: true,
    apiKey: `${id}-key`,
    providerSpecificData: {},
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  db.getSettings.mockResolvedValue({ fallbackStrategy: "fill-first" });
  db.getProxyPools.mockResolvedValue([]);
  db.getProviderConnectionById.mockResolvedValue(null);
  db.updateProviderConnection.mockResolvedValue({});
  proxy.resolveConnectionProxyConfig.mockResolvedValue({
    connectionProxyEnabled: false,
    connectionProxyUrl: "",
    connectionNoProxy: "",
    proxyPoolId: null,
    vercelRelayUrl: "",
    strictProxy: false,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("model/account lock routing", () => {
  it("treats model-specific and account-wide locks cumulatively", () => {
    const conn = connection("a", {
      modelLock_target: isoAfter(-1_000),
      modelLock___all: isoAfter(120_000),
    });

    expect(isModelLockActive(conn, "target")).toBe(true);
    expect(getRelevantModelLockUntil(conn, "target")).toBe(isoAfter(120_000));

    conn.modelLock_target = isoAfter(300_000);
    expect(getRelevantModelLockUntil(conn, "target")).toBe(isoAfter(300_000));
  });

  it("reports the earliest account that actually unlocks for the requested model", async () => {
    db.getProviderConnections.mockResolvedValue([
      connection("slow", {
        modelLock_target: isoAfter(300_000),
        modelLock_unrelated: isoAfter(30_000),
        lastError: "slow error",
        errorCode: 429,
      }),
      connection("fast", {
        modelLock_target: isoAfter(120_000),
        lastError: "fast error",
        errorCode: 503,
      }),
    ]);

    const result = await getProviderCredentials("openai", null, "target");

    expect(result).toMatchObject({
      allRateLimited: true,
      retryAfter: isoAfter(120_000),
      lastError: "fast error",
      lastErrorCode: 503,
    });
  });

  it("fails a strict account pin instead of silently selecting another account", async () => {
    db.getProviderConnections.mockResolvedValue([connection("available")]);

    await expect(getProviderCredentials("openai", null, "gpt-5", {
      preferredConnectionId: "missing",
      strictPreferredConnection: true,
    })).resolves.toBeNull();

    await expect(getProviderCredentials("openai", null, "gpt-5", {
      preferredConnectionId: "missing",
    })).resolves.toMatchObject({ connectionId: "available" });
  });

  it("propagates strict proxy-pool policy with selected credentials", async () => {
    db.getProviderConnections.mockResolvedValue([connection("proxied")]);
    proxy.resolveConnectionProxyConfig.mockResolvedValue({
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.example:8080",
      connectionNoProxy: "localhost",
      proxyPoolId: "pool-1",
      vercelRelayUrl: "",
      strictProxy: true,
    });

    const credentials = await getProviderCredentials("openai", null, "gpt-5");
    expect(credentials.providerSpecificData).toMatchObject({
      connectionProxyEnabled: true,
      connectionProxyPoolId: "pool-1",
      strictProxy: true,
    });
  });

  it("honors an explicit zero priority when initializing round-robin", async () => {
    db.getSettings.mockResolvedValue({
      fallbackStrategy: "round-robin",
      stickyRoundRobinLimit: 2,
    });
    db.getProviderConnections.mockResolvedValue([
      connection("normal", { priority: 1 }),
      connection("first", { priority: 0 }),
    ]);

    const credentials = await getProviderCredentials("openai", null, "gpt-5");

    expect(credentials.connectionId).toBe("first");
    expect(db.updateProviderConnection).toHaveBeenCalledWith("first", expect.objectContaining({
      consecutiveUseCount: 1,
    }));
  });

  it("does not read or rewrite a healthy account on every success", async () => {
    const healthy = connection("healthy", { testStatus: "active" });

    await clearAccountError("healthy", healthy, "gpt-5");

    expect(db.getProviderConnectionById).not.toHaveBeenCalled();
    expect(db.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("cleans locks against the latest row without hiding another active model lock", async () => {
    const staleSnapshot = connection("fresh", {
      testStatus: "unavailable",
      lastError: "old quota",
      modelLock_target: isoAfter(-1_000),
    });
    db.getProviderConnectionById.mockResolvedValue(connection("fresh", {
      testStatus: "unavailable",
      lastError: "quota",
      modelLock_target: isoAfter(-1_000),
      modelLock_other: isoAfter(120_000),
    }));

    await clearAccountError("fresh", staleSnapshot, "target");

    expect(db.updateProviderConnection).toHaveBeenCalledWith("fresh", {
      modelLock_target: null,
    });
  });

  it("does not erase a fresh lock installed by another in-flight request", async () => {
    const selectedSnapshot = connection("concurrent", {
      testStatus: "unavailable",
      lastError: "old failure",
      modelLock_old: isoAfter(-1_000),
    });
    db.getProviderConnectionById.mockResolvedValue(connection("concurrent", {
      testStatus: "unavailable",
      lastError: "newer failure",
      modelLock_old: isoAfter(-1_000),
      modelLock_target: isoAfter(120_000),
    }));

    await clearAccountError("concurrent", selectedSnapshot, "target");

    expect(db.updateProviderConnection).toHaveBeenCalledWith("concurrent", {
      modelLock_old: null,
    });
  });
});
