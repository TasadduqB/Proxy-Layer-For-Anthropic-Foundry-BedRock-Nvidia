import { decryptString, encryptString } from "./secureStorage.js";

export function parseJson(str, fallback = null) {
  if (str == null) return fallback;
  if (typeof str !== "string") return str;
  const plaintext = decryptString(str);
  // Legacy rows predating the JSON-envelope convention store the raw string
  // itself (unquoted); recover it instead of discarding it as `fallback`.
  try { return JSON.parse(plaintext); } catch { return plaintext; }
}

export function stringifyJson(value) {
  return encryptString(JSON.stringify(value ?? null));
}

