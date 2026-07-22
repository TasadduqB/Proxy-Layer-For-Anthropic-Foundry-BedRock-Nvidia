import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalEncryption = process.env.PROXY_MAX_ENCRYPT_AT_REST;
const originalKey = process.env.PROXY_MAX_ENCRYPTION_KEY;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-max-encryption-"));
  process.env.DATA_DIR = tempDir;
  process.env.PROXY_MAX_ENCRYPT_AT_REST = "1";
  delete process.env.PROXY_MAX_ENCRYPTION_KEY;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch { /* best effort */ }
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalEncryption === undefined) delete process.env.PROXY_MAX_ENCRYPT_AT_REST;
  else process.env.PROXY_MAX_ENCRYPT_AT_REST = originalEncryption;
  if (originalKey === undefined) delete process.env.PROXY_MAX_ENCRYPTION_KEY;
  else process.env.PROXY_MAX_ENCRYPTION_KEY = originalKey;
});

describe("Proxy-Max encrypted database storage", () => {
  it("encrypts JSON records and API keys while preserving the public DB API", async () => {
    const dbApi = await import("@/lib/db/index.js");
    await dbApi.initDb();
    const connection = await dbApi.createProviderConnection({
      provider: "openai",
      authType: "apikey",
      name: "encrypted-test",
      apiKey: "provider-secret-value",
    });
    await dbApi.updateSettings({ oidcClientSecret: "oidc-secret-value" });
    await dbApi.createProxyPool({ name: "secure-proxy", proxyUrl: "http://user:proxy-secret@proxy.example:8080" });
    const apiKey = await dbApi.createApiKey("client", "machine-test");

    const { getAdapter } = await import("@/lib/db/driver.js");
    const rawDb = await getAdapter();
    const rawConnection = rawDb.get(`SELECT data FROM providerConnections WHERE id = ?`, [connection.id]);
    const rawSettings = rawDb.get(`SELECT data FROM settings WHERE id = 1`);
    const rawClientKey = rawDb.get(`SELECT key, keyHash FROM apiKeys WHERE id = ?`, [apiKey.id]);

    expect(rawConnection.data).toMatch(/^pmx:v1:/);
    expect(rawConnection.data).not.toContain("provider-secret-value");
    expect(rawSettings.data).toMatch(/^pmx:v1:/);
    expect(rawSettings.data).not.toContain("oidc-secret-value");
    expect(rawClientKey.key).toMatch(/^pmx:v1:/);
    expect(rawClientKey.key).not.toContain(apiKey.key);
    expect(rawClientKey.keyHash).toBe(crypto.createHash("sha256").update(apiKey.key).digest("hex"));

    expect((await dbApi.getProviderConnectionById(connection.id)).apiKey).toBe("provider-secret-value");
    expect((await dbApi.getSettings()).oidcClientSecret).toBe("oidc-secret-value");
    expect(await dbApi.validateApiKey(apiKey.key)).toBe(true);
    expect((await dbApi.getApiKeyById(apiKey.id)).key).toBe(apiKey.key);

    const exported = await dbApi.exportDb();
    expect(exported.databaseFormatVersion).toBe(3);
    expect(exported.providerConnections[0].apiKey).toBe("provider-secret-value");
    expect(exported.apiKeys[0].key).toBe(apiKey.key);

    const keyPath = path.join(tempDir, ".proxy-max-master-key");
    expect(fs.statSync(keyPath).mode & 0o777).toBe(0o600);
    expect(fs.statSync(tempDir).mode & 0o777).toBe(0o700);
  });

  it("upgrades plaintext rows in place and fails closed on corrupt ciphertext", async () => {
    const dbApi = await import("@/lib/db/index.js");
    await dbApi.initDb();
    const { getAdapter } = await import("@/lib/db/driver.js");
    const rawDb = await getAdapter();
    const now = new Date().toISOString();
    rawDb.run(`INSERT OR REPLACE INTO settings(id, data) VALUES(1, ?)`, [JSON.stringify({ oidcClientSecret: "legacy-secret" })]);
    rawDb.run(
      `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, ?, ?)`,
      ["legacy-key", "sk-legacy-plaintext", "legacy", "machine", 1, now]
    );

    const secure = await import("@/lib/db/helpers/secureStorage.js");
    const result = secure.protectDatabaseAtRest(rawDb);
    expect(result.encryptedColumns).toBeGreaterThanOrEqual(1);
    expect(result.encryptedApiKeys).toBe(1);
    expect(rawDb.get(`SELECT data FROM settings WHERE id = 1`).data).toMatch(/^pmx:v1:/);
    expect(rawDb.get(`SELECT key FROM apiKeys WHERE id = 'legacy-key'`).key).toMatch(/^pmx:v1:/);
    expect(await dbApi.validateApiKey("sk-legacy-plaintext")).toBe(true);
    expect((await dbApi.getSettings()).oidcClientSecret).toBe("legacy-secret");
    expect(() => secure.decryptString("pmx:v1:not-valid-ciphertext")).toThrow(/could not be decrypted/);
  });
});

