const AUTH_SESSION_TTL_MS = 10 * 60 * 1000;
const MAX_AUTH_SESSIONS = 256;
const STORE_SYMBOL = Symbol.for("proxy-max.oauth.authorizationSessions");
const MISSING_STATE_ALLOWED_PROVIDERS = new Set([
  "cline",
  "clinepass",
  "kimchi",
  "kiro-social:google",
  "kiro-social:github",
]);

// OAuth endpoints can be emitted as separate Next.js route bundles. Keeping
// the bounded store on globalThis lets those bundles share one process-local
// session registry without persisting PKCE verifiers or OAuth metadata.
const pendingAuthorizationSessions =
  globalThis[STORE_SYMBOL] instanceof Map
    ? globalThis[STORE_SYMBOL]
    : new Map();
globalThis[STORE_SYMBOL] = pendingAuthorizationSessions;

function canonicalMeta(meta) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return "{}";
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(meta)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => [String(key), String(value)])
        .sort(([a], [b]) => a.localeCompare(b))
    )
  );
}

function purgeAuthorizationSessions(now = Date.now()) {
  for (const [state, session] of pendingAuthorizationSessions) {
    if (now - session.createdAt >= AUTH_SESSION_TTL_MS) {
      pendingAuthorizationSessions.delete(state);
    }
  }
  while (pendingAuthorizationSessions.size >= MAX_AUTH_SESSIONS) {
    const oldest = pendingAuthorizationSessions.keys().next().value;
    if (!oldest) break;
    pendingAuthorizationSessions.delete(oldest);
  }
}

export function registerAuthorizationSession(provider, authData, meta) {
  if (
    !provider ||
    typeof authData?.state !== "string" ||
    !authData.state ||
    typeof authData?.redirectUri !== "string" ||
    !authData.redirectUri ||
    typeof authData?.codeVerifier !== "string" ||
    !authData.codeVerifier
  ) {
    return false;
  }

  purgeAuthorizationSessions();
  pendingAuthorizationSessions.set(authData.state, {
    provider,
    redirectUri: authData.redirectUri,
    codeVerifier: authData.codeVerifier,
    meta: canonicalMeta(meta),
    createdAt: Date.now(),
  });
  return true;
}

/**
 * Consume a short-lived authorization session before exchanging a code.
 * Missing callback state is tolerated only when the unguessable PKCE verifier
 * and redirect URI identify one exact session (some provider callbacks do not
 * consistently echo state). A supplied mismatched state is always rejected.
 */
export function consumeAuthorizationSession(provider, input = {}) {
  purgeAuthorizationSessions();
  const suppliedState = typeof input.state === "string" ? input.state.trim() : "";
  let state = suppliedState;
  let session = state ? pendingAuthorizationSessions.get(state) : null;

  if (!state && MISSING_STATE_ALLOWED_PROVIDERS.has(provider)) {
    const candidates = [...pendingAuthorizationSessions.entries()].filter(([, candidate]) =>
      candidate.provider === provider &&
      candidate.redirectUri === input.redirectUri &&
      candidate.codeVerifier === input.codeVerifier
    );
    if (candidates.length === 1) {
      [state, session] = candidates[0];
    }
  }

  if (!session) {
    return { ok: false, error: "OAuth session not found or expired; restart the login flow" };
  }
  if (
    session.provider !== provider ||
    session.redirectUri !== input.redirectUri ||
    session.codeVerifier !== input.codeVerifier ||
    session.meta !== canonicalMeta(input.meta)
  ) {
    return { ok: false, error: "OAuth session validation failed; restart the login flow" };
  }

  pendingAuthorizationSessions.delete(state);
  return { ok: true };
}
