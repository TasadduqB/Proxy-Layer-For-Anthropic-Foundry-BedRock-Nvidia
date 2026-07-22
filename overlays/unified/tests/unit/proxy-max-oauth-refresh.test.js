import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nativeFetch = globalThis.fetch;
const originalPrivateOAuthHosts = process.env.PROXY_MAX_ALLOW_PRIVATE_OAUTH_HOSTS;

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  });
}

describe("Proxy-Max OAuth refresh lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.fetch = nativeFetch;
    vi.doUnmock("jose");
    if (originalPrivateOAuthHosts === undefined) {
      delete process.env.PROXY_MAX_ALLOW_PRIVATE_OAUTH_HOSTS;
    } else {
      process.env.PROXY_MAX_ALLOW_PRIVATE_OAUTH_HOSTS = originalPrivateOAuthHosts;
    }
  });

  it.each(["cline", "clinepass"])("uses the Cline JSON refresh contract for %s", async (provider) => {
    const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
    const fetchMock = vi.fn(async () => jsonResponse({
      data: {
        accessToken: "rotated-access",
        refreshToken: "rotated-refresh",
        expiresAt,
      },
    }));
    globalThis.fetch = fetchMock;

    const { refreshTokenByProvider } = await import("../../open-sse/services/tokenRefresh.js");
    const result = await refreshTokenByProvider(provider, {
      connectionId: `${provider}-connection`,
      refreshToken: `${provider}-old-refresh`,
    });

    expect(result).toMatchObject({
      accessToken: "workos:rotated-access",
      refreshToken: "rotated-refresh",
    });
    expect(result.expiresIn).toBeGreaterThan(3500);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({
      refreshToken: `${provider}-old-refresh`,
      grantType: "refresh_token",
      clientType: "extension",
    });
  });

  it("refreshes GitLab with its stored origin/client and preserves metadata", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      access_token: "gitlab-new-access",
      refresh_token: "gitlab-new-refresh",
      expires_in: 7200,
    }));
    globalThis.fetch = fetchMock;

    const { refreshTokenByProvider } = await import("../../open-sse/services/tokenRefresh.js");
    const result = await refreshTokenByProvider("gitlab", {
      connectionId: "gitlab-1",
      refreshToken: "gitlab-old-refresh",
      providerSpecificData: {
        baseUrl: "https://8.8.8.8",
        clientId: "gitlab-client",
        clientSecret: "gitlab-secret",
        username: "octo",
      },
    });

    expect(result).toMatchObject({
      accessToken: "gitlab-new-access",
      refreshToken: "gitlab-new-refresh",
      expiresIn: 7200,
      providerSpecificData: {
        baseUrl: "https://8.8.8.8",
        clientId: "gitlab-client",
        clientSecret: "gitlab-secret",
        username: "octo",
        authKind: "oauth",
      },
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://8.8.8.8/oauth/token");
    expect(Object.fromEntries(init.body.entries())).toEqual({
      grant_type: "refresh_token",
      refresh_token: "gitlab-old-refresh",
      client_id: "gitlab-client",
      client_secret: "gitlab-secret",
    });
  });

  it("blocks private GitLab OAuth origins before fetch", async () => {
    delete process.env.PROXY_MAX_ALLOW_PRIVATE_OAUTH_HOSTS;
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    const { refreshTokenByProvider } = await import("../../open-sse/services/tokenRefresh.js");

    await expect(refreshTokenByProvider("gitlab", {
      connectionId: "gitlab-private",
      refreshToken: "gitlab-private-refresh",
      providerSpecificData: { baseUrl: "http://127.0.0.1:8080", clientId: "client" },
    })).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("permits an explicitly opted-in HTTPS private GitLab origin", async () => {
    process.env.PROXY_MAX_ALLOW_PRIVATE_OAUTH_HOSTS = "1";
    const fetchMock = vi.fn(async () => jsonResponse({
      access_token: "private-gitlab-access",
      expires_in: 3600,
    }));
    globalThis.fetch = fetchMock;
    const { refreshTokenByProvider } = await import("../../open-sse/services/tokenRefresh.js");

    const result = await refreshTokenByProvider("gitlab", {
      connectionId: "private-gitlab",
      refreshToken: "private-gitlab-refresh",
      providerSpecificData: {
        baseUrl: "https://127.0.0.1:8443",
        clientId: "private-client",
      },
    });

    expect(result.accessToken).toBe("private-gitlab-access");
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://127.0.0.1:8443/oauth/token"),
      expect.objectContaining({ method: "POST", redirect: "manual" })
    );
  });

  it("does not accept a successful refresh response without an access token", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({
      refresh_token: "rotated-but-invalid",
      expires_in: 3600,
    }));
    const { refreshGoogleToken } = await import("../../open-sse/services/tokenRefresh.js");

    await expect(refreshGoogleToken("google-missing-access", "client", "secret"))
      .resolves.toBeNull();
  });

  it("contains ordinary network failures instead of failing the user request", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("offline");
    });
    const { refreshProviderCredentials } = await import(
      "../../open-sse/services/oauthCredentialManager.js"
    );

    await expect(refreshProviderCredentials("iflow", {
      connectionId: "iflow-offline",
      refreshToken: "iflow-refresh-offline",
    })).resolves.toBeNull();
  });

  it("mints Vertex service-account tokens without requiring a refreshToken field", async () => {
    vi.doMock("jose", () => ({
      importPKCS8: vi.fn(async () => ({})),
      SignJWT: class {
        setProtectedHeader() { return this; }
        setIssuer() { return this; }
        setAudience() { return this; }
        setIssuedAt() { return this; }
        setExpirationTime() { return this; }
        async sign() { return "signed-assertion"; }
      },
    }));
    const fetchMock = vi.fn(async () => jsonResponse({
      access_token: "vertex-access",
      expires_in: 3600,
    }));
    globalThis.fetch = fetchMock;
    const { refreshTokenByProvider } = await import("../../open-sse/services/tokenRefresh.js");
    const result = await refreshTokenByProvider("vertex", {
      apiKey: JSON.stringify({
        type: "service_account",
        client_email: "robot@example.iam.gserviceaccount.com",
        private_key: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----",
        project_id: "project-1",
      }),
    }, null, { vercelRelayUrl: "https://relay.example/token" });

    expect(result.accessToken).toBe("vertex-access");
    expect(result.expiresAt).toBeGreaterThan(Date.now());
    expect(fetchMock).toHaveBeenCalledWith(
      "https://relay.example/token",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-relay-target": "https://oauth2.googleapis.com",
          "x-relay-path": "/token",
        }),
      })
    );
  });

  it("threads per-connection proxy options through Google refresh", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      access_token: "google-access",
      expires_in: 3600,
    }));
    globalThis.fetch = fetchMock;
    const { refreshProviderCredentials } = await import(
      "../../open-sse/services/oauthCredentialManager.js"
    );

    const result = await refreshProviderCredentials(
      "gemini-cli",
      { connectionId: "google-proxy", refreshToken: "google-refresh" },
      null,
      { vercelRelayUrl: "https://relay.example/token" }
    );

    expect(result.accessToken).toBe("google-access");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://relay.example/token",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-relay-target": "https://oauth2.googleapis.com",
          "x-relay-path": "/token",
        }),
      })
    );
  });

  it("threads Vertex executor proxy options through token mint and model request", async () => {
    vi.doMock("jose", () => ({
      importPKCS8: vi.fn(async () => ({})),
      SignJWT: class {
        setProtectedHeader() { return this; }
        setIssuer() { return this; }
        setAudience() { return this; }
        setIssuedAt() { return this; }
        setExpirationTime() { return this; }
        async sign() { return "signed-assertion"; }
      },
    }));
    const fetchMock = vi.fn(async (_url, init = {}) => {
      if (init.headers?.["x-relay-target"] === "https://oauth2.googleapis.com") {
        return jsonResponse({ access_token: "vertex-executor-access", expires_in: 3600 });
      }
      return jsonResponse({ candidates: [] });
    });
    globalThis.fetch = fetchMock;
    const { VertexExecutor } = await import("../../open-sse/executors/vertex.js");
    const credentials = {
      apiKey: JSON.stringify({
        type: "service_account",
        client_email: "executor@example.iam.gserviceaccount.com",
        private_key: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----",
        project_id: "executor-project",
      }),
      providerSpecificData: { location: "us-central1" },
    };

    const result = await new VertexExecutor().execute({
      model: "gemini-2.5-pro",
      body: { contents: [] },
      stream: false,
      credentials,
      log: null,
      proxyOptions: { vercelRelayUrl: "https://relay.example/token" },
    });

    expect(result.response.ok).toBe(true);
    expect(credentials.accessToken).toBe("vertex-executor-access");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([, init]) => init.headers["x-relay-target"]))
      .toEqual([
        "https://oauth2.googleapis.com",
        "https://aiplatform.googleapis.com",
      ]);
  });
});

describe("Proxy-Max authorization-code session binding", () => {
  beforeEach(() => {
    vi.resetModules();
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = nativeFetch;
  });

  it("accepts a matching state once and rejects replay", async () => {
    const { generateAuthData, consumeAuthorizationSession } = await import(
      "../../src/lib/oauth/providers.js"
    );
    const auth = await generateAuthData("claude", "http://localhost:20128/callback");
    const input = {
      state: auth.state,
      redirectUri: auth.redirectUri,
      codeVerifier: auth.codeVerifier,
    };

    expect(consumeAuthorizationSession("claude", input)).toEqual({ ok: true });
    expect(consumeAuthorizationSession("claude", input)).toMatchObject({ ok: false });
  });

  it("rejects supplied state mismatch but supports callbacks that omit state", async () => {
    const { generateAuthData, consumeAuthorizationSession } = await import(
      "../../src/lib/oauth/providers.js"
    );
    const auth = await generateAuthData("cline", "http://localhost:20128/callback");
    const base = { redirectUri: auth.redirectUri, codeVerifier: auth.codeVerifier };

    expect(consumeAuthorizationSession("cline", { ...base, state: "wrong-state" }))
      .toMatchObject({ ok: false });
    expect(consumeAuthorizationSession("cline", base)).toEqual({ ok: true });
  });

  it("requires state for providers whose callbacks are state-compliant", async () => {
    const { generateAuthData, consumeAuthorizationSession } = await import(
      "../../src/lib/oauth/providers.js"
    );
    const auth = await generateAuthData("claude", "http://localhost:20128/callback");

    expect(consumeAuthorizationSession("claude", {
      redirectUri: auth.redirectUri,
      codeVerifier: auth.codeVerifier,
    })).toMatchObject({ ok: false });
    expect(consumeAuthorizationSession("claude", {
      state: auth.state,
      redirectUri: auth.redirectUri,
      codeVerifier: auth.codeVerifier,
    })).toEqual({ ok: true });
  });

  it("binds GitLab provider metadata to the authorization session", async () => {
    const { generateAuthData, consumeAuthorizationSession } = await import(
      "../../src/lib/oauth/providers.js"
    );
    const meta = { baseUrl: "https://gitlab.com", clientId: "client-1" };
    const auth = await generateAuthData("gitlab", "http://localhost:20128/callback", meta);
    const base = {
      state: auth.state,
      redirectUri: auth.redirectUri,
      codeVerifier: auth.codeVerifier,
    };

    expect(consumeAuthorizationSession("gitlab", {
      ...base,
      meta: { ...meta, clientId: "attacker-client" },
    })).toMatchObject({ ok: false });
    expect(consumeAuthorizationSession("gitlab", { ...base, meta })).toEqual({ ok: true });
  });

  it("rejects token-exchange payloads that omit the provider access token", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({
      refresh_token: "orphan-refresh-token",
      expires_in: 3600,
    }));
    const { exchangeTokens } = await import("../../src/lib/oauth/providers.js");

    await expect(exchangeTokens(
      "claude",
      "auth-code",
      "http://localhost:20128/callback",
      "verifier",
      "state"
    )).rejects.toThrow(/no access token/);
  });

  it("maps GitLab identity and refresh metadata without losing it", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        access_token: "gitlab-access",
        refresh_token: "gitlab-refresh",
        expires_in: 3600,
        scope: "api read_user",
      }))
      .mockResolvedValueOnce(jsonResponse({
        username: "octocat",
        name: "Octo Cat",
        email: "octo@example.com",
      }));
    const { exchangeTokens } = await import("../../src/lib/oauth/providers.js");
    const result = await exchangeTokens(
      "gitlab",
      "auth-code",
      "http://localhost:20128/callback",
      "verifier",
      "state",
      {
        baseUrl: "https://8.8.8.8",
        clientId: "client-1",
        clientSecret: "secret-1",
      }
    );

    expect(result).toMatchObject({
      accessToken: "gitlab-access",
      refreshToken: "gitlab-refresh",
      email: "octo@example.com",
      displayName: "Octo Cat",
      providerSpecificData: {
        username: "octocat",
        baseUrl: "https://8.8.8.8",
        clientId: "client-1",
        clientSecret: "secret-1",
        authKind: "oauth",
      },
    });
  });
});
