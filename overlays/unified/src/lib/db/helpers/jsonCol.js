import { decryptString, encryptString } from "./secureStorage.js";

export function parseJson(str, fallback = null) {
  if (str == null) return fallback;
  if (typeof str !== "string") return str;
  const plaintext = decryptString(str);
  try { return JSON.parse(plaintext); } catch { return fallback; }
}

export function stringifyJson(value) {
  return encryptString(JSON.stringify(value ?? null));
}

