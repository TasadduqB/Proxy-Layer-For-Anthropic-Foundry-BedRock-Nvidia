import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDataDir } from "@/lib/dataDir.js";

describe("Proxy Max build data isolation", () => {
  it("preserves the configured directory during normal runtime", () => {
    expect(resolveDataDir({ DATA_DIR: "/tmp/proxy-max-data" }, {
      pid: 4242,
      threadId: 0,
    })).toBe("/tmp/proxy-max-data");
  });

  it("uses deterministic process-and-thread-scoped directories for Next build workers", () => {
    const env = {
      DATA_DIR: "/ignored-during-build",
      PROXY_MAX_UNIFIED_BUILD_DATA_ROOT: "/tmp/proxy-max-build",
    };
    expect(resolveDataDir(env, {
      pid: 4242,
      threadId: 0,
    })).toBe(path.join("/tmp/proxy-max-build", "worker-4242-0"));
    expect(resolveDataDir(env, {
      pid: 4242,
      threadId: 7,
    })).toBe(path.join("/tmp/proxy-max-build", "worker-4242-7"));
    expect(resolveDataDir(env, {
      pid: 4343,
      threadId: 0,
    })).toBe(path.join("/tmp/proxy-max-build", "worker-4343-0"));
  });

  it("retains the platform default when no data directory is configured", () => {
    expect(resolveDataDir({}, {
      platform: "linux",
      homeDir: "/home/proxy-max",
    })).toBe(path.join("/home/proxy-max", ".proxy-max"));
  });
});
