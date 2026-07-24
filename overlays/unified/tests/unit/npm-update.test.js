import { describe, expect, it, vi } from "vitest";
import {
  assertNpmUpdateReady,
  compareVersions,
  getNpmUpdateStatus,
} from "@/lib/npmUpdate";

describe("npm package updates", () => {
  it("compares stable and prerelease versions", () => {
    expect(compareVersions("2.1.0", "2.0.9")).toBe(1);
    expect(compareVersions("2.0.0", "2.0.0")).toBe(0);
    expect(compareVersions("2.0.0-beta.1", "2.0.0")).toBe(-1);
  });

  it("reports a trusted registry update", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      name: "proxy-max",
      version: "2.1.0",
    }), { status: 200 }));
    const status = await getNpmUpdateStatus("2.0.0", { fetchImpl });
    expect(status).toMatchObject({
      source: "npm",
      currentVersion: "2.0.0",
      latestVersion: "2.1.0",
      hasUpdate: true,
      canUpdate: true,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("rejects mismatched registry metadata", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      name: "not-proxy-max",
      version: "99.0.0",
    }), { status: 200 }));
    await expect(getNpmUpdateStatus("2.0.0", { fetchImpl })).rejects.toThrow(
      "did not match Proxy Max",
    );
  });

  it("does not start an updater when already current", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      name: "proxy-max",
      version: "2.0.0",
    }), { status: 200 }));
    await expect(assertNpmUpdateReady("2.0.0", { fetchImpl })).rejects.toMatchObject({
      statusCode: 409,
    });
  });
});
