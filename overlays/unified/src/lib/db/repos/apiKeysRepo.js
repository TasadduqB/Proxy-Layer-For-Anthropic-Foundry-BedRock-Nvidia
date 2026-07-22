import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { decryptString, encryptString, hashSecret } from "../helpers/secureStorage.js";

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: decryptString(row.key),
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
  };
}

function writeKey(db, apiKey) {
  const plaintext = String(apiKey.key || "");
  db.run(
    `INSERT INTO apiKeys(id, key, keyHash, name, machineId, isActive, createdAt)
     VALUES(?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET key=excluded.key, keyHash=excluded.keyHash,
       name=excluded.name, machineId=excluded.machineId, isActive=excluded.isActive`,
    [apiKey.id, encryptString(plaintext), hashSecret(plaintext), apiKey.name, apiKey.machineId, apiKey.isActive ? 1 : 0, apiKey.createdAt]
  );
}

export async function getApiKeys() {
  const db = await getAdapter();
  return db.all(`SELECT * FROM apiKeys ORDER BY createdAt ASC`).map(rowToKey);
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  return rowToKey(db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]));
}

export async function createApiKey(name, machineId) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    createdAt: new Date().toISOString(),
  };
  writeKey(db, apiKey);
  return apiKey;
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToKey(row), ...data };
    writeKey(db, merged);
    result = merged;
  });
  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

export async function validateApiKey(key) {
  if (typeof key !== "string" || !key) return false;
  const db = await getAdapter();
  const row = db.get(`SELECT isActive FROM apiKeys WHERE keyHash = ? OR key = ?`, [hashSecret(key), key]);
  return !!row && (row.isActive === 1 || row.isActive === true);
}

