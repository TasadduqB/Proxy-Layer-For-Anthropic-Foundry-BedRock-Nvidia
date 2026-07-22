import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  next: Symbol("next"),
  getSettings: vi.fn(),
  validateApiKey: vi.fn(),
  machineId: vi.fn(),
  verifyToken: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    next: vi.fn(() => mocks.next),
    json: vi.fn((body, init) => ({ status: init?.status || 200, body })),
    redirect: vi.fn(),
  },
}));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings, validateApiKey: mocks.validateApiKey }));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: mocks.machineId }));
vi.mock("@/lib/auth/dashboardSession", () => ({ verifyDashboardAuthToken: mocks.verifyToken }));

const { proxy } = await import("../../src/dashboardGuard.js");

function request(pathname, headers = {}, cookie = null) {
  return {
    nextUrl: { pathname, searchParams: new URL(`http://localhost${pathname}`).searchParams },
    headers: new Headers(headers),
    cookies: { get: () => cookie ? { value: cookie } : undefined },
    url: `http://localhost${pathname}`,
  };
}

describe("privileged API routes are local-only", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireLogin: true });
    mocks.machineId.mockResolvedValue("cli-token");
    mocks.verifyToken.mockResolvedValue(true);
  });

  it.each([
    "/api/version",
    "/api/version/update",
    "/api/version/shutdown",
    "/api/shutdown",
    "/api/pxpipe/install",
    "/api/pxpipe/start",
    "/api/pxpipe/stop",
    "/api/pxpipe/restart",
    "/api/pxpipe/logs",
  ])("rejects authenticated remote access to %s", async (pathname) => {
    const response = await proxy(request(pathname, {
      host: "router.example.com",
      "x-9r-real-ip": "10.1.2.3",
      origin: "https://router.example.com",
    }, "valid-jwt"));
    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/Local only/);
  });

  it("allows a local authenticated PXPIPE install", async () => {
    const response = await proxy(request("/api/pxpipe/install", {
      host: "localhost:20128",
      "x-9r-real-ip": "127.0.0.1",
      origin: "http://localhost:20128",
    }, "valid-jwt"));
    expect(response).toBe(mocks.next);
  });

  it("allows an authenticated update check on loopback", async () => {
    const response = await proxy(request("/api/version", {
      host: "localhost:20128",
      "x-9r-real-ip": "127.0.0.1",
      origin: "http://localhost:20128",
    }, "valid-jwt"));
    expect(response).toBe(mocks.next);
  });

  it("does not let a machine token bypass the loopback boundary", async () => {
    const response = await proxy(request("/api/version/shutdown", {
      host: "router.example.com",
      "x-9r-real-ip": "10.1.2.3",
      "x-9r-cli-token": "cli-token",
    }));
    expect(response.status).toBe(403);
  });

  it("allows the machine-bound CLI token on loopback", async () => {
    const response = await proxy(request("/api/version/shutdown", {
      host: "localhost:20128",
      "x-9r-real-ip": "127.0.0.1",
      "x-9r-cli-token": "cli-token",
    }));
    expect(response).toBe(mocks.next);
  });
});
