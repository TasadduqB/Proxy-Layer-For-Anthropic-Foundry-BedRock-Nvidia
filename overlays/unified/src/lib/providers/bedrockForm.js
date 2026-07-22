/** Build a Bedrock edit payload without ever clearing the long-lived secret implicitly. */
export function buildBedrockProviderSpecificData({
  region,
  endpoint,
  secretAccessKey,
  sessionToken,
  clearSessionToken = false,
} = {}) {
  const result = {
    region: String(region || "us-east-1").trim() || "us-east-1",
    endpoint: String(endpoint || "").trim(),
  };
  const secret = String(secretAccessKey || "").trim();
  const session = String(sessionToken || "").trim();
  // Omission means preserve the existing secret. Mask markers are deliberately
  // sent back so mergeMaskedSecrets can restore their stored values.
  if (secret) result.secretAccessKey = secret;
  if (clearSessionToken) result.sessionToken = "";
  else if (session) result.sessionToken = session;
  return result;
}
