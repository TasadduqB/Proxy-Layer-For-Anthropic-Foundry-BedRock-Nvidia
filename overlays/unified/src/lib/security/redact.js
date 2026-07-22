export const MASKED_VALUE = "••••••••";

const CREDENTIAL_KEYS = new Set([
  "apikey", "apikeys", "accesskey", "accesskeyid", "secretkey", "secretaccesskey",
  "sessiontoken", "token", "authtoken", "accesstoken", "refreshtoken", "idtoken",
  "password", "clientsecret", "privatekey", "credential", "credentials",
  "authorization", "proxyauthorization", "cookie", "setcookie", "signature",
  "bearertoken", "oidcclientsecret", "mitmsudoencrypted",
]);

function compactKey(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export function isCredentialKey(value) {
  const key = compactKey(value);
  return CREDENTIAL_KEYS.has(key) || key.includes("credential") ||
    /(?:apikeys?|accesskeys?(?:id)?|secret(?:access)?keys?|sessiontokens?|auth(?:orization|tokens?)|accesstokens?|refreshtokens?|idtokens?|bearertokens?|clientsecrets?|privatekeys?|passwords?|cookies?|signatures?)$/.test(key);
}

export function containsMaskedValue(value) {
  if (typeof value !== "string") return false;
  if (value.includes(MASKED_VALUE) || value.includes("[REDACTED]")) return true;
  try { return decodeURIComponent(value).includes(MASKED_VALUE); } catch { return false; }
}

export function maskUrlCredentials(value) {
  if (typeof value !== "string" || !value) return value;
  try {
    const url = new URL(value);
    if (url.username) url.username = MASKED_VALUE;
    if (url.password) url.password = MASKED_VALUE;
    for (const key of [...url.searchParams.keys()]) {
      if (isCredentialKey(key)) url.searchParams.set(key, MASKED_VALUE);
    }
    if (/(?:token|secret|signature|api[-_]?key)=/i.test(url.hash || "")) url.hash = "#redacted";
    return url.toString();
  } catch {
    return value
      .replace(/:\/\/([^/@\s:]+):([^/@\s]+)@/g, `://${MASKED_VALUE}:${MASKED_VALUE}@`)
      .replace(/([?&#](?:token|secret|signature|api[-_]?key)=)[^&#\s]*/gi, `$1${MASKED_VALUE}`);
  }
}

export function redactCredentialObject(value, fieldName = "", seen = new WeakSet()) {
  if (value == null) return value;
  if (isCredentialKey(fieldName)) return value === "" ? "" : MASKED_VALUE;
  if (typeof value === "string") {
    return /(?:url|uri|endpoint|proxy)$/i.test(fieldName) ? maskUrlCredentials(value) : value;
  }
  if (typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactCredentialObject(item, "", seen));
  const output = {};
  for (const [key, nested] of Object.entries(value)) output[key] = redactCredentialObject(nested, key, seen);
  return output;
}

export function mergeMaskedSecrets(incoming, existing) {
  if (incoming === undefined) return existing;
  if (typeof incoming === "string" && containsMaskedValue(incoming)) return existing;
  if (Array.isArray(incoming)) {
    const prior = Array.isArray(existing) ? existing : [];
    return incoming.map((item, index) => mergeMaskedSecrets(item, prior[index]));
  }
  if (incoming && typeof incoming === "object") {
    const prior = existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {};
    const output = { ...prior };
    for (const [key, value] of Object.entries(incoming)) {
      output[key] = mergeMaskedSecrets(value, prior[key]);
    }
    return output;
  }
  return incoming;
}
