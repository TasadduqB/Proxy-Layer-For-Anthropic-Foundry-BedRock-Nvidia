import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fsPromises from "fs/promises";
import { execFile } from "child_process";

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    })),
  },
}));

vi.mock("os", () => ({
  default: { homedir: vi.fn(() => "/mock/home") },
  homedir: vi.fn(() => "/mock/home"),
}));

vi.mock("fs/promises", () => ({
  access: vi.fn(),
  constants: { R_OK: 4 },
}));

vi.mock("child_process", () => ({ execFile: vi.fn() }));

const mockDbInstance = {
  prepare: vi.fn(),
  close: vi.fn(),
  __throwOnConstruct: false,
};

vi.mock("better-sqlite3", () => ({
  default: class MockDatabase {
    constructor() {
      if (mockDbInstance.__throwOnConstruct) {
        throw new Error("SQLITE_CANTOPEN");
      }
      return mockDbInstance;
    }
  },
}));

let GET;

describe("GET /api/oauth/cursor/auto-import", () => {
  const originalPlatform = process.platform;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbInstance.__throwOnConstruct = false;
    vi.mocked(execFile).mockImplementation((_file, _args, _options, callback) => {
      callback(new Error("sqlite3 unavailable"));
    });
    Object.defineProperty(process, "platform", {
      value: "darwin",
      writable: true,
    });
    const mod = await import(
      "../../src/app/api/oauth/cursor/auto-import/route.js"
    );
    GET = mod.GET;
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      writable: true,
    });
  });

  it("reports every macOS path when no Cursor database is accessible", async () => {
    vi.mocked(fsPromises.access).mockRejectedValue(new Error("ENOENT"));

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("Cursor database not found");
    expect(response.body.error).toContain("Application Support/Cursor");
    expect(fsPromises.access).toHaveBeenCalledTimes(2);
  });

  it("returns a descriptive error when every SQLite reader fails", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockDbInstance.__throwOnConstruct = true;

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("could not be opened");
    expect(response.body.error).toContain("SQLITE_CANTOPEN");
    expect(response.body.error).toContain("sqlite3 unavailable");
    expect(response.body.error).not.toContain("test-token");
  });

  it("extracts tokens using exact keys in priority order", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockDbInstance.prepare.mockReturnValue({
      all: vi.fn().mockReturnValue([
        { key: "cursorAuth/token", value: "lower-priority-token" },
        { key: "cursorAuth/accessToken", value: "test-token" },
        { key: "storage.serviceMachineId", value: "test-machine-id" },
      ]),
    });

    const response = await GET();

    expect(response.body).toEqual({
      found: true,
      accessToken: "test-token",
      machineId: "test-machine-id",
    });
    expect(mockDbInstance.close).toHaveBeenCalledOnce();
    expect(execFile).not.toHaveBeenCalled();
  });

  it("unwraps JSON-encoded string values", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockDbInstance.prepare.mockReturnValue({
      all: vi.fn().mockReturnValue([
        { key: "cursorAuth/accessToken", value: '"json-token"' },
        { key: "storage.serviceMachineId", value: '"json-machine-id"' },
      ]),
    });

    const response = await GET();

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("json-token");
    expect(response.body.machineId).toBe("json-machine-id");
  });

  it("falls back to narrowly matched renamed keys", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockDbInstance.prepare.mockImplementation((query) => {
      if (query.includes(" IN (")) {
        return { all: vi.fn().mockReturnValue([]) };
      }
      return {
        all: vi.fn().mockReturnValue([
          { key: "cursorAuth/someOtherAccessTokenKey", value: "fallback-token" },
          { key: "storage.someMachineId", value: "fallback-machine" },
          { key: "unrelated.secret", value: "must-not-be-selected" },
        ]),
      };
    });

    const response = await GET();

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("fallback-token");
    expect(response.body.machineId).toBe("fallback-machine");
  });

  it("closes the database even when a prepared query throws", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockDbInstance.prepare.mockImplementation(() => {
      throw new Error("corrupt database");
    });

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("corrupt database");
    expect(mockDbInstance.close).toHaveBeenCalledOnce();
  });

  it("asks the user to login when a readable database has no credentials", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockDbInstance.prepare.mockReturnValue({
      all: vi.fn().mockReturnValue([]),
    });

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("Please login to Cursor IDE first");
    expect(response.body.windowsManual).toBe(false);
  });

  it("probes both Linux paths and reports them when neither exists", async () => {
    Object.defineProperty(process, "platform", {
      value: "linux",
      writable: true,
    });
    vi.mocked(fsPromises.access).mockRejectedValue(new Error("ENOENT"));

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain(".config/Cursor");
    expect(response.body.error).toContain(".config/cursor");
    expect(fsPromises.access).toHaveBeenCalledTimes(2);
  });

  it("rejects unsupported platforms before probing the filesystem", async () => {
    Object.defineProperty(process, "platform", {
      value: "freebsd",
      writable: true,
    });

    const response = await GET();

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Unsupported platform");
    expect(fsPromises.access).not.toHaveBeenCalled();
  });
});
