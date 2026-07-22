import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeAuthorizationSession: vi.fn(),
  createProviderConnection: vi.fn(),
  exchangeTokens: vi.fn(),
  startCodexProxy: vi.fn(),
  startXaiProxy: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
}));

vi.mock("@/lib/oauth/providers", () => ({
  getProvider: vi.fn(() => ({ flowType: "authorization_code" })),
  generateAuthData: vi.fn(),
  exchangeTokens: mocks.exchangeTokens,
  requestDeviceCode: vi.fn(),
  pollForToken: vi.fn(),
  consumeAuthorizationSession: mocks.consumeAuthorizationSession,
  extractCodexAccountInfo: vi.fn(() => ({})),
}));

vi.mock("@/models", () => ({
  createProviderConnection: mocks.createProviderConnection,
}));

vi.mock("@/lib/oauth/utils/server", () => ({
  startCodexProxy: mocks.startCodexProxy,
  stopCodexProxy: vi.fn(),
  registerCodexSession: vi.fn(),
  getCodexSessionStatus: vi.fn(),
  clearCodexSession: vi.fn(),
  startXaiProxy: mocks.startXaiProxy,
  stopXaiProxy: vi.fn(),
  registerXaiSession: vi.fn(),
  getXaiSessionStatus: vi.fn(),
  clearXaiSession: vi.fn(),
}));

function postRequest(provider, body) {
  return new Request(`http://localhost/api/oauth/${provider}/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Proxy-Max OAuth dynamic route guardrails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.consumeAuthorizationSession.mockReturnValue({ ok: true });
    mocks.exchangeTokens.mockResolvedValue({ accessToken: "access", expiresIn: 3600 });
    mocks.createProviderConnection.mockImplementation(async (data) => ({ id: "connection-1", ...data }));
    mocks.startCodexProxy.mockResolvedValue({ success: true });
    mocks.startXaiProxy.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects raw JWT credential import for non-Codex providers", async () => {
    const { POST } = await import("../../src/app/api/oauth/[provider]/[action]/route.js");
    const response = await POST(postRequest("claude", {
      code: "eyJhbGciOiJub25lIn0.eyJlbWFpbCI6InVzZXJAZXhhbXBsZS5jb20ifQ.signature",
      redirectUri: "http://localhost/callback",
      codeVerifier: "verifier",
      state: "state",
    }), { params: Promise.resolve({ provider: "claude", action: "exchange" }) });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/only supported for codex/i) });
    expect(mocks.createProviderConnection).not.toHaveBeenCalled();
    expect(mocks.exchangeTokens).not.toHaveBeenCalled();
  });

  it("rejects an exchange whose state/PKCE session does not match", async () => {
    mocks.consumeAuthorizationSession.mockReturnValue({
      ok: false,
      error: "OAuth session validation failed; restart the login flow",
    });
    const { POST } = await import("../../src/app/api/oauth/[provider]/[action]/route.js");
    const response = await POST(postRequest("claude", {
      code: "authorization-code",
      redirectUri: "http://localhost/callback",
      codeVerifier: "wrong-verifier",
      state: "wrong-state",
    }), { params: Promise.resolve({ provider: "claude", action: "exchange" }) });

    expect(response.status).toBe(400);
    expect(mocks.exchangeTokens).not.toHaveBeenCalled();
    expect(mocks.createProviderConnection).not.toHaveBeenCalled();
  });

  it("creates a connection only after authorization-session validation", async () => {
    const { POST } = await import("../../src/app/api/oauth/[provider]/[action]/route.js");
    const response = await POST(postRequest("claude", {
      code: "authorization-code",
      redirectUri: "http://localhost/callback",
      codeVerifier: "verifier",
      state: "state",
    }), { params: Promise.resolve({ provider: "claude", action: "exchange" }) });

    expect(response.status).toBe(200);
    expect(mocks.consumeAuthorizationSession).toHaveBeenCalledBefore(mocks.exchangeTokens);
    expect(mocks.exchangeTokens).toHaveBeenCalledBefore(mocks.createProviderConnection);
  });

  it.each(["0", "-1", "65536", "not-a-port"])("rejects invalid callback proxy port %s", async (appPort) => {
    const { GET } = await import("../../src/app/api/oauth/[provider]/[action]/route.js");
    const response = await GET(
      new Request(`http://localhost/api/oauth/codex/start-proxy?app_port=${encodeURIComponent(appPort)}`),
      { params: Promise.resolve({ provider: "codex", action: "start-proxy" }) }
    );

    expect(response.status).toBe(400);
    expect(mocks.startCodexProxy).not.toHaveBeenCalled();
  });
});
