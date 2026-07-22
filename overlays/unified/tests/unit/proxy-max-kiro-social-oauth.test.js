import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildSocialLoginUrl: vi.fn(),
  exchangeSocialCode: vi.fn(),
  extractEmailFromJWT: vi.fn(),
  createProviderConnection: vi.fn(),
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

vi.mock("@/lib/oauth/services/kiro", () => ({
  KiroService: class {
    buildSocialLoginUrl(...args) {
      return mocks.buildSocialLoginUrl(...args);
    }

    exchangeSocialCode(...args) {
      return mocks.exchangeSocialCode(...args);
    }

    extractEmailFromJWT(...args) {
      return mocks.extractEmailFromJWT(...args);
    }
  },
}));

vi.mock("@/models", () => ({
  createProviderConnection: mocks.createProviderConnection,
}));

async function authorize(provider = "google") {
  const { GET } = await import("../../src/app/api/oauth/kiro/social-authorize/route.js");
  const response = await GET(new Request(
    `http://localhost/api/oauth/kiro/social-authorize?provider=${provider}`
  ));
  return { response, body: await response.json() };
}

async function exchange(body) {
  const { POST } = await import("../../src/app/api/oauth/kiro/social-exchange/route.js");
  const response = await POST(new Request("http://localhost/api/oauth/kiro/social-exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
  return { response, body: await response.json() };
}

describe("Proxy-Max Kiro social OAuth session binding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildSocialLoginUrl.mockImplementation((provider, challenge, state) =>
      `https://auth.example/authorize?provider=${provider}&challenge=${challenge}&state=${state}`
    );
    mocks.exchangeSocialCode.mockResolvedValue({
      accessToken: "kiro-access",
      refreshToken: "kiro-refresh",
      expiresIn: 3600,
      profileArn: "arn:aws:codewhisperer:us-east-1:123:profile/test",
    });
    mocks.extractEmailFromJWT.mockReturnValue("user@example.com");
    mocks.createProviderConnection.mockImplementation(async (data) => ({
      id: "kiro-connection",
      ...data,
    }));
  });

  it("accepts the existing UI contract by matching the issued PKCE verifier", async () => {
    const { body: auth } = await authorize("google");
    const { response } = await exchange({
      code: "authorization-code",
      codeVerifier: auth.codeVerifier,
      provider: "google",
    });

    expect(response.status).toBe(200);
    expect(mocks.exchangeSocialCode).toHaveBeenCalledWith(
      "authorization-code",
      auth.codeVerifier
    );
    expect(mocks.exchangeSocialCode).toHaveBeenCalledBefore(mocks.createProviderConnection);
  });

  it("rejects a supplied state mismatch without consuming the valid session", async () => {
    const { body: auth } = await authorize("github");
    const rejected = await exchange({
      code: "authorization-code",
      codeVerifier: auth.codeVerifier,
      provider: "github",
      state: "attacker-state",
    });
    expect(rejected.response.status).toBe(400);
    expect(mocks.exchangeSocialCode).not.toHaveBeenCalled();

    const accepted = await exchange({
      code: "authorization-code",
      codeVerifier: auth.codeVerifier,
      provider: "github",
      state: auth.state,
    });
    expect(accepted.response.status).toBe(200);
  });

  it("consumes a social OAuth session once and rejects replay", async () => {
    const { body: auth } = await authorize("google");
    const request = {
      code: "authorization-code",
      codeVerifier: auth.codeVerifier,
      provider: "google",
      state: auth.state,
    };

    expect((await exchange(request)).response.status).toBe(200);
    expect((await exchange(request)).response.status).toBe(400);
    expect(mocks.exchangeSocialCode).toHaveBeenCalledTimes(1);
    expect(mocks.createProviderConnection).toHaveBeenCalledTimes(1);
  });
});
