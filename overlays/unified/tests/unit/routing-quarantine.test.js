import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let cleanup = () => {};

async function setupDb() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-max-routing-quarantine-"));
  process.env.DATA_DIR = tempDir;
  try { global._dbAdapter?.instance?.close?.(); } catch { /* best effort */ }
  delete global._dbAdapter;
  vi.resetModules();
  const db = await import("@/lib/db/index.js");
  return {
    ...db,
    cleanup() {
      try { global._dbAdapter?.instance?.close?.(); } catch { /* best effort */ }
      delete global._dbAdapter;
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

afterEach(() => {
  cleanup();
  cleanup = () => {};
  vi.resetModules();
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("persistent routing quarantine", () => {
  it("disables provider connections, disabled-model entries, and combo routes atomically", async () => {
    const db = await setupDb();
    cleanup = db.cleanup;
    await db.createProviderConnection({
      provider: "openrouter",
      authType: "apikey",
      name: "OpenRouter primary",
      apiKey: "test-key",
    });
    const combo = await db.createCombo({
      name: "claude-auto",
      models: [
        "openrouter/openrouter/free",
        "openrouter/openai/gpt-oss-120b:free",
        "nvidia/deepseek-ai/deepseek-v4-flash",
      ],
    });

    const result = await db.quarantineRoutingTarget({
      provider: "openrouter",
      modelStr: "openrouter/openrouter/free",
      scope: "provider",
      status: 429,
      reason: "free-models-per-day exhausted",
      retryAt: "2026-08-14T00:00:00.000Z",
    });

    expect(result.disabledConnections).toBe(1);
    expect(result.disabledModelEntries).toBeGreaterThan(0);
    expect(result.changedCombos).toHaveLength(1);
    await expect(db.getComboById(combo.id)).resolves.toMatchObject({
      models: ["nvidia/deepseek-ai/deepseek-v4-flash"],
    });
    const connections = await db.getProviderConnections({ provider: "openrouter" });
    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({
      isActive: false,
      testStatus: "unavailable",
      errorCode: 429,
      automaticallyDisabledReason: "free-models-per-day exhausted",
    });
    const disabled = await db.getDisabledModels();
    expect(disabled.openrouter).toEqual(expect.arrayContaining([
      "openrouter/free",
      "openai/gpt-oss-120b:free",
    ]));
  });

  it("removes only the unavailable model without disabling provider credentials", async () => {
    const db = await setupDb();
    cleanup = db.cleanup;
    await db.createProviderConnection({
      provider: "tokenrouter",
      authType: "apikey",
      name: "TokenRouter",
      apiKey: "test-key",
    });
    const combo = await db.createCombo({
      name: "claude-auto",
      models: [
        "tokenrouter/moonshotai/kimi-k3-free",
        "tokenrouter/another-model",
        "nvidia/deepseek-ai/deepseek-v4-flash",
      ],
    });

    const result = await db.quarantineRoutingTarget({
      provider: "tokenrouter",
      modelStr: "tokenrouter/moonshotai/kimi-k3-free",
      scope: "model",
      status: 503,
      reason: "No available channel",
    });

    expect(result.changed).toBe(true);
    expect(result.disabledModelEntries).toBeGreaterThan(0);
    await expect(db.getComboById(combo.id)).resolves.toMatchObject({
      models: [
        "tokenrouter/another-model",
        "nvidia/deepseek-ai/deepseek-v4-flash",
      ],
    });
    const connections = await db.getProviderConnections({ provider: "tokenrouter" });
    expect(connections[0].isActive).toBe(true);
    await expect(db.getDisabledByProvider("tokenrouter")).resolves.toContain(
      "moonshotai/kimi-k3-free",
    );
  });
});
