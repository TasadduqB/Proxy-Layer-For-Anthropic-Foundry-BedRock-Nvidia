import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  generateAuthData,
  getProvider,
  getProviderNames,
  pollForToken,
  requestDeviceCode,
} from "../../src/lib/oauth/providers.js";

const nativeFetch = globalThis.fetch;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Proxy-Max OAuth provider flow inventory", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("offline discovery");
    });
  });

  afterEach(() => {
    globalThis.fetch = nativeFetch;
  });

  it("keeps every upstream dashboard OAuth/import provider reachable", async () => {
    const expected = {
      claude: "authorization_code_pkce",
      codex: "authorization_code_pkce",
      xai: "authorization_code_pkce",
      "grok-cli": "device_code",
      "gemini-cli": "authorization_code",
      antigravity: "authorization_code",
      iflow: "authorization_code",
      qoder: "device_code",
      qwen: "device_code",
      github: "device_code",
      kiro: "device_code",
      cursor: "import_token",
      kimi: "device_code",
      kilocode: "device_code",
      cline: "authorization_code",
      clinepass: "authorization_code",
      gitlab: "authorization_code_pkce",
      "codebuddy-cn": "device_code",
      kimchi: "browser_token",
    };

    expect(new Set(getProviderNames())).toEqual(new Set(Object.keys(expected)));
    for (const [provider, flowType] of Object.entries(expected)) {
      expect(getProvider(provider).flowType, provider).toBe(flowType);
    }
    expect(getProvider("kimi-coding")).toBe(getProvider("kimi"));
  });

  it.each([
    ["claude"], ["codex"], ["xai"], ["gemini-cli"], ["antigravity"],
    ["iflow"], ["cline"], ["clinepass"], ["kimchi"],
  ])("generates a bound browser authorization flow for %s", async (provider) => {
    const auth = await generateAuthData(provider, "http://localhost:20128/callback");

    expect(auth.authUrl).toMatch(/^https:\/\//);
    expect(auth.state.length).toBeGreaterThanOrEqual(40);
    expect(auth.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(auth.codeChallenge.length).toBeGreaterThanOrEqual(40);
    expect(auth.redirectUri).toBe("http://localhost:20128/callback");
  });

  it("requires and binds GitLab OAuth application metadata", async () => {
    await expect(generateAuthData("gitlab", "http://localhost/callback", {
      baseUrl: "https://gitlab.com",
    })).rejects.toThrow(/client ID is required/);

    const auth = await generateAuthData("gitlab", "http://localhost/callback", {
      baseUrl: "https://gitlab.com",
      clientId: "gitlab-client",
    });
    expect(new URL(auth.authUrl).searchParams.get("client_id")).toBe("gitlab-client");
  });

  it.each([
    "grok-cli", "qoder", "qwen", "github", "kiro", "kimi", "kilocode", "codebuddy-cn",
  ])("returns no premature browser URL for device provider %s", async (provider) => {
    const auth = await generateAuthData(provider, null);
    expect(auth.authUrl).toBeNull();
    expect(auth.flowType).toBe("device_code");
  });

  it("returns import metadata instead of throwing for Cursor", async () => {
    const auth = await generateAuthData("cursor", null);
    expect(auth).toMatchObject({ authUrl: null, flowType: "import_token" });
  });
});

describe("Proxy-Max OAuth device-code request contracts", () => {
  afterEach(() => {
    globalThis.fetch = nativeFetch;
  });

  const cases = [
    {
      provider: "qwen",
      responses: [{ device_code: "qwen-device", user_code: "QWEN", verification_uri: "https://qwen.example/activate", expires_in: 600 }],
    },
    {
      provider: "github",
      responses: [{ device_code: "github-device", user_code: "GITHUB", verification_uri: "https://github.com/login/device", expires_in: 900 }],
    },
    {
      provider: "kimi",
      responses: [{ device_code: "kimi-device", user_code: "KIMI", verification_uri: "https://www.kimi.com/code/authorize_device", expires_in: 600 }],
    },
    {
      provider: "kilocode",
      responses: [{ code: "kilo-device", verificationUrl: "https://app.kilo.ai/auth", expiresIn: 300 }],
    },
    {
      provider: "codebuddy-cn",
      responses: [{ code: 0, data: { state: "codebuddy-state", authUrl: "https://copilot.tencent.com/auth" } }],
    },
    {
      provider: "grok-cli",
      responses: [{ device_code: "grok-device", user_code: "GROK", verification_uri: "https://auth.x.ai/device", expires_in: 600 }],
    },
  ];

  it.each(cases)("requests a complete $provider device challenge", async ({ provider, responses }) => {
    globalThis.fetch = vi.fn(async () => jsonResponse(responses.shift()));
    const result = await requestDeviceCode(provider, provider === "qwen" ? "challenge" : undefined);

    expect(result.device_code, provider).toBeTruthy();
    expect(result.verification_uri || result.verification_uri_complete, provider).toBeTruthy();
  });

  it("performs both AWS Kiro client-registration and device-authorization steps", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ clientId: "aws-client", clientSecret: "aws-secret" }))
      .mockResolvedValueOnce(jsonResponse({
        deviceCode: "kiro-device",
        userCode: "KIRO",
        verificationUri: "https://device.sso.us-east-1.amazonaws.com/",
        verificationUriComplete: "https://device.sso.us-east-1.amazonaws.com/?user_code=KIRO",
        expiresIn: 600,
        interval: 5,
      }));
    globalThis.fetch = fetchMock;
    const result = await requestDeviceCode("kiro", undefined, {
      region: "us-east-1",
      authMethod: "builder-id",
    });

    expect(result).toMatchObject({
      device_code: "kiro-device",
      _clientId: "aws-client",
      _clientSecret: "aws-secret",
      _region: "us-east-1",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("Proxy-Max OAuth device-code token mapping", () => {
  afterEach(() => {
    globalThis.fetch = nativeFetch;
  });

  const cases = [
    {
      provider: "qwen",
      extraData: undefined,
      responses: [{ access_token: "qwen-access", refresh_token: "qwen-refresh", expires_in: 3600, resource_url: "https://qwen.example/api" }],
      expected: { accessToken: "qwen-access", providerSpecificData: { resourceUrl: "https://qwen.example/api" } },
    },
    {
      provider: "kimi",
      extraData: { _kimiDeviceId: "kimi-device-id" },
      responses: [{ access_token: "kimi-access", refresh_token: "kimi-refresh", expires_in: 3600 }],
      expected: { accessToken: "kimi-access", providerSpecificData: { deviceId: "kimi-device-id" } },
    },
    {
      provider: "kiro",
      extraData: { _clientId: "aws-client", _clientSecret: "aws-secret", _region: "us-east-1", _authMethod: "builder-id" },
      responses: [{ accessToken: "kiro-access", refreshToken: "kiro-refresh", expiresIn: 3600, profileArn: "arn:aws:codewhisperer:us-east-1:123:profile/test" }],
      expected: { accessToken: "kiro-access", providerSpecificData: { clientId: "aws-client", profileArn: "arn:aws:codewhisperer:us-east-1:123:profile/test" } },
    },
    {
      provider: "codebuddy-cn",
      extraData: undefined,
      responses: [{ code: 0, data: { accessToken: "codebuddy-access", refreshToken: "codebuddy-refresh", expiresIn: 3600 } }],
      expected: { accessToken: "codebuddy-access", refreshToken: "codebuddy-refresh" },
    },
    {
      provider: "kilocode",
      extraData: undefined,
      responses: [
        { status: "approved", token: "kilo-access", userEmail: "kilo@example.com" },
        { organizations: [{ id: "org-1" }] },
      ],
      expected: { accessToken: "kilo-access", email: "kilo@example.com", providerSpecificData: { orgId: "org-1" } },
    },
    {
      provider: "github",
      extraData: undefined,
      responses: [
        { access_token: "github-access", expires_in: 3600 },
        { token: "copilot-token", expires_at: 2_000_000_000 },
        { id: 42, login: "octocat", name: "Octo Cat", email: "octo@example.com" },
      ],
      expected: { accessToken: "github-access", email: "octo@example.com", providerSpecificData: { copilotToken: "copilot-token" } },
    },
    {
      provider: "grok-cli",
      extraData: undefined,
      responses: [
        { access_token: "grok-access", refresh_token: "grok-refresh", expires_in: 2700 },
        { email: "grok@example.com", userId: "grok-user", firstName: "Grok", lastName: "User" },
      ],
      expected: { accessToken: "grok-access", email: "grok@example.com", providerSpecificData: { userId: "grok-user" } },
    },
  ];

  it.each(cases)("maps a completed $provider device flow into durable credentials", async ({ provider, extraData, responses, expected }) => {
    const queue = [...responses];
    globalThis.fetch = vi.fn(async () => jsonResponse(queue.shift()));
    const result = await pollForToken(provider, `${provider}-device-code`, provider === "qwen" ? "verifier" : null, extraData);

    expect(result.success, provider).toBe(true);
    expect(result.tokens).toMatchObject(expected);
  });

  it("distinguishes pending authorization from terminal device errors", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ error: "authorization_pending" }, 400));
    await expect(pollForToken("github", "device", null)).resolves.toMatchObject({
      success: false,
      pending: true,
      error: "authorization_pending",
    });
  });
});
