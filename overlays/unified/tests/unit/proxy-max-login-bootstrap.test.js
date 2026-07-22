import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  cookies: vi.fn(),
  setDashboardAuthCookie: vi.fn(),
  checkLock: vi.fn(),
  recordFail: vi.fn(),
  recordSuccess: vi.fn(),
  getClientIp: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(value, init = {}) {
      return new Response(JSON.stringify(value), {
        status: init.status || 200,
        headers: { "content-type": "application/json", ...(init.headers || {}) },
      });
    },
  },
}));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings, updateSettings: mocks.updateSettings }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/auth/dashboardSession", () => ({ setDashboardAuthCookie: mocks.setDashboardAuthCookie }));
vi.mock("@/lib/auth/oidc", () => ({ isOidcConfigured: () => false }));
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: vi.fn() }));
vi.mock("open-sse/services/combo.js", () => ({ resetComboRotation: vi.fn() }));
vi.mock("@/lib/auth/loginLimiter", () => ({
  checkLock: mocks.checkLock,
  recordFail: mocks.recordFail,
  recordSuccess: mocks.recordSuccess,
  getClientIp: mocks.getClientIp,
}));

const { POST } = await import("../../src/app/api/auth/login/route.js");
const { PATCH } = await import("../../src/app/api/settings/route.js");

function request(password) {
  return new Request("http://127.0.0.1:8787/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", host: "127.0.0.1:8787" },
    body: JSON.stringify({ password }),
  });
}

describe("Proxy Max first-run login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.INITIAL_PASSWORD;
    mocks.getSettings.mockResolvedValue({ authMode: "password", password: null });
    mocks.updateSettings.mockImplementation(async (value) => value);
    mocks.cookies.mockResolvedValue({ set: vi.fn() });
    mocks.checkLock.mockReturnValue({ locked: false });
    mocks.recordFail.mockReturnValue({ remainingBeforeLock: 4 });
    mocks.getClientIp.mockReturnValue("127.0.0.1");
  });

  afterEach(() => {
    delete process.env.INITIAL_PASSWORD;
  });

  it("forces replacement of the built-in bootstrap password on loopback", async () => {
    const response = await POST(request("123456"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, mustChangePassword: true });
    expect(mocks.setDashboardAuthCookie).toHaveBeenCalledOnce();
    expect(mocks.recordSuccess).toHaveBeenCalledWith("127.0.0.1");
  });

  it("respects an operator-provided INITIAL_PASSWORD without forcing replacement", async () => {
    process.env.INITIAL_PASSWORD = "operator-bootstrap-secret";
    const response = await POST(request("operator-bootstrap-secret"));
    expect(await response.json()).toEqual({ success: true, mustChangePassword: false });
  });

  it("returns a generic lockout-safe failure and does not create a cookie", async () => {
    const response = await POST(request("wrong"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Invalid password. 4 attempt(s) left before lockout." });
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
  });

  it("requires and accepts the built-in bootstrap credential when setting the first password", async () => {
    const missing = await PATCH(new Request("http://127.0.0.1:8787/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newPassword: "a-new-private-password" }),
    }));
    expect(missing.status).toBe(400);

    const accepted = await PATCH(new Request("http://127.0.0.1:8787/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: "123456", newPassword: "a-new-private-password" }),
    }));
    expect(accepted.status).toBe(200);
    const stored = mocks.updateSettings.mock.calls.at(-1)[0];
    expect(stored.password).not.toContain("a-new-private-password");
    expect(stored).not.toHaveProperty("currentPassword");
    expect(stored).not.toHaveProperty("newPassword");
  });

  it("uses INITIAL_PASSWORD as the first-password proof when configured", async () => {
    process.env.INITIAL_PASSWORD = "operator-bootstrap-secret";
    const wrong = await PATCH(new Request("http://127.0.0.1:8787/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: "123456", newPassword: "a-new-private-password" }),
    }));
    expect(wrong.status).toBe(401);

    const accepted = await PATCH(new Request("http://127.0.0.1:8787/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: "operator-bootstrap-secret", newPassword: "a-new-private-password" }),
    }));
    expect(accepted.status).toBe(200);
  });
});
