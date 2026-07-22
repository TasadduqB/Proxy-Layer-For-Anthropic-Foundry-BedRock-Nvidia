import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir.js";

const ENVELOPE_PREFIX = "pmx:v1:";
const AAD = Buffer.from("proxy-max/storage/v1", "utf8");
// Read-only compatibility for data encrypted before the unified Proxy Max
// naming migration. Keep the historical identifier encoded, not user-facing.
const LEGACY_AAD = Buffer.from("cHJveHktbWF4Lzlyb3V0ZXIvc3RvcmFnZS92MQ==", "base64");
const KEY_FILE = path.join(DATA_DIR, ".proxy-max-master-key");
let cachedKey = null;

export function encryptionEnabled() {
  const configured = String(process.env.PROXY_MAX_ENCRYPT_AT_REST || "").trim().toLowerCase();
  if (["0", "false", "off", "no"].includes(configured)) return false;
  if (["1", "true", "on", "yes"].includes(configured)) return true;
  // Keep upstream unit tests deterministic unless a test explicitly opts in.
  return process.env.NODE_ENV !== "test";
}

function parseConfiguredKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^[a-fA-F0-9]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  try {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === 32 && decoded.toString("base64").replace(/=+$/, "") === raw.replace(/=+$/, "")) return decoded;
  } catch { /* fall through to passphrase derivation */ }
  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

function readOrCreateLocalKey() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(DATA_DIR, 0o700); } catch { /* best effort on Windows */ }

  try {
    const existing = fs.readFileSync(KEY_FILE);
    if (existing.length !== 32) throw new Error(`Invalid Proxy-Max master key length at ${KEY_FILE}`);
    try { fs.chmodSync(KEY_FILE, 0o600); } catch { /* best effort */ }
    return existing;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const generated = crypto.randomBytes(32);
  try {
    const fd = fs.openSync(KEY_FILE, "wx", 0o600);
    try {
      fs.writeFileSync(fd, generated);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    return generated;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const winner = fs.readFileSync(KEY_FILE);
    if (winner.length !== 32) throw new Error(`Invalid Proxy-Max master key length at ${KEY_FILE}`);
    return winner;
  }
}

function getKey() {
  if (cachedKey) return cachedKey;
  cachedKey = parseConfiguredKey(process.env.PROXY_MAX_ENCRYPTION_KEY) || readOrCreateLocalKey();
  return cachedKey;
}

export function getEncryptionKeyPath() {
  return process.env.PROXY_MAX_ENCRYPTION_KEY ? null : KEY_FILE;
}

export function isEncryptedString(value) {
  return typeof value === "string" && value.startsWith(ENVELOPE_PREFIX);
}

export function encryptString(value) {
  const plaintext = String(value ?? "");
  if (!encryptionEnabled() || isEncryptedString(plaintext)) return plaintext;

  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), nonce);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENVELOPE_PREFIX}${Buffer.concat([nonce, tag, ciphertext]).toString("base64url")}`;
}

export function decryptString(value) {
  if (!isEncryptedString(value)) return value;
  const decryptWithAad = (aad) => {
    const packed = Buffer.from(value.slice(ENVELOPE_PREFIX.length), "base64url");
    if (packed.length < 29) throw new Error("truncated envelope");
    const nonce = packed.subarray(0, 12);
    const tag = packed.subarray(12, 28);
    const ciphertext = packed.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), nonce);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  };
  try {
    return decryptWithAad(AAD);
  } catch (error) {
    try {
      return decryptWithAad(LEGACY_AAD);
    } catch {
      throw new Error("Encrypted Proxy-Max data could not be decrypted; restore the matching master key or PROXY_MAX_ENCRYPTION_KEY", { cause: error });
    }
  }
}

export function hashSecret(value) {
  return crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

export function protectDatabaseAtRest(adapter) {
  if (!encryptionEnabled()) return { encryptedColumns: 0, encryptedApiKeys: 0 };

  const jsonColumns = [
    ["settings", "id", "data"],
    ["providerConnections", "id", "data"],
    ["providerNodes", "id", "data"],
    ["proxyPools", "id", "data"],
    ["combos", "id", "models"],
    ["kv", "rowid", "value"],
    ["usageHistory", "id", "tokens"],
    ["usageHistory", "id", "meta"],
    ["usageDaily", "rowid", "data"],
    ["requestDetails", "id", "data"],
  ];
  let encryptedColumns = 0;
  let encryptedApiKeys = 0;

  adapter.transaction(() => {
    for (const [table, idColumn, valueColumn] of jsonColumns) {
      for (const row of adapter.all(`SELECT ${idColumn} AS rowId, ${valueColumn} AS storedValue FROM ${table}`)) {
        if (row.storedValue == null || isEncryptedString(row.storedValue)) continue;
        adapter.run(`UPDATE ${table} SET ${valueColumn} = ? WHERE ${idColumn} = ?`, [encryptString(row.storedValue), row.rowId]);
        encryptedColumns += 1;
      }
    }

    for (const row of adapter.all(`SELECT id, key, keyHash FROM apiKeys`)) {
      const plaintext = decryptString(row.key);
      const encrypted = encryptString(plaintext);
      const digest = hashSecret(plaintext);
      if (encrypted !== row.key || digest !== row.keyHash) {
        adapter.run(`UPDATE apiKeys SET key = ?, keyHash = ? WHERE id = ?`, [encrypted, digest, row.id]);
        encryptedApiKeys += 1;
      }
    }
  });
  adapter.checkpoint?.();
  return { encryptedColumns, encryptedApiKeys };
}
