import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { __test__, normalizeGitRemoteUrl } from "../../src/lib/gitUpdate.js";
import { GIT_UPDATE_CONFIG } from "../../src/shared/constants/config.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "../..");

describe("Proxy Max Git update policy", () => {
  it("checks and updates from the canonical repository", () => {
    expect(GIT_UPDATE_CONFIG.repositoryUrl).toBe(
      "https://github.com/TasadduqB/Proxy-Layer-For-Anthropic-Foundry-BedRock-Nvidia.git",
    );
    expect(GIT_UPDATE_CONFIG.remote).toBe("origin");
    expect(GIT_UPDATE_CONFIG.branch).toBe("main");
  });

  it("normalizes only credential-free GitHub HTTPS or SSH remotes", () => {
    expect(normalizeGitRemoteUrl("https://github.com/TasadduqB/Proxy-Max.git"))
      .toBe("https://github.com/tasadduqb/proxy-max");
    expect(normalizeGitRemoteUrl("git@github.com:TasadduqB/Proxy-Max.git"))
      .toBe("https://github.com/tasadduqb/proxy-max");
    expect(normalizeGitRemoteUrl("http://github.com/TasadduqB/Proxy-Max.git")).toBeNull();
    expect(normalizeGitRemoteUrl("https://token@github.com/TasadduqB/Proxy-Max.git")).toBeNull();
    expect(normalizeGitRemoteUrl("https://example.com/TasadduqB/Proxy-Max.git")).toBeNull();
  });

  it("rejects unsafe branch names", () => {
    expect(__test__.assertSafeBranch("main")).toBe("main");
    expect(__test__.assertSafeBranch("release/v2")).toBe("release/v2");
    for (const branch of ["../main", "main..evil", "main//evil", "main/", "-main", "main;id"]) {
      expect(() => __test__.assertSafeBranch(branch)).toThrow(/invalid/i);
    }
  });

  it("blocks an available update for dirty or divergent checkouts", () => {
    expect(__test__.knownBlockedReason({ dirtyCount: 2, behind: 1, ahead: 0 })).toMatch(/stash/i);
    expect(__test__.knownBlockedReason({ dirtyCount: 0, behind: 1, ahead: 1 })).toMatch(/diverged/i);
    expect(__test__.knownBlockedReason({ dirtyCount: 0, behind: 1, ahead: 0 })).toBeNull();
    expect(__test__.knownBlockedReason({ dirtyCount: 4, behind: 0, ahead: 0 })).toBeNull();
  });

  it("keeps the detached updater shell-free, fast-forward-only, and rollback-capable", () => {
    const source = fs.readFileSync(path.join(root, "src/lib/updater/git-updater.js"), "utf8");
    expect(source).not.toMatch(/\bexec(?:File|Sync)?\s*\(/);
    expect(source).not.toMatch(/shell\s*:\s*true/);
    expect(source).toContain('"merge", "--ff-only"');
    expect(source).toContain('"status", "--porcelain=v1"');
    expect(source).toContain('"reset", "--hard", before');
    expect(source).toContain("actualRemote !== expectedRepository");
    expect(source).toContain("MAX_CAPTURE_BYTES");
  });
});
