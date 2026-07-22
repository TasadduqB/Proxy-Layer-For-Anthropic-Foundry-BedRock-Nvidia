import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

function loadCjs(relativePath, dataDir) {
  const old = process.env.DATA_DIR;
  process.env.DATA_DIR = dataDir;
  const absolute = require.resolve(relativePath);
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}src${path.sep}mitm${path.sep}`)) delete require.cache[key];
  }
  try { return require(absolute); }
  finally {
    if (old === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = old;
  }
}

describe("MITM privileged-operation hardening", () => {
  it("stores the generated CA private key with owner-only permissions", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "9r-ca-mode-"));
    const root = loadCjs("../../src/mitm/cert/rootCA.js", dataDir);
    root.generateRootCA();
    const key = path.join(dataDir, "mitm", "rootCA.key");
    expect(fs.existsSync(key)).toBe(true);
    if (process.platform !== "win32") expect(fs.statSync(key).mode & 0o777).toBe(0o600);
  });

  it("rejects certificate-domain injection and malformed hostnames", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "9r-ca-domain-"));
    const root = loadCjs("../../src/mitm/cert/rootCA.js", dataDir);
    root.generateRootCA();
    const ca = root.loadRootCA();
    expect(() => root.generateLeafCert("good.example.com", ca)).not.toThrow();
    expect(() => root.generateLeafCert("bad.example.com\nsubject=evil", ca)).toThrow(/Invalid certificate domain/);
    expect(() => root.generateLeafCert("../evil", ca)).toThrow(/Invalid certificate domain/);
  });

  it("matches exact hosts fields instead of substrings or comments", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "9r-dns-match-"));
    const dnsConfig = loadCjs("../../src/mitm/dns/dnsConfig.js", dataDir);
    const { lineContainsHost } = dnsConfig.__test__;
    expect(lineContainsHost("127.0.0.1 api.example.com", "api.example.com")).toBe(true);
    expect(lineContainsHost("127.0.0.1 not-api.example.com", "api.example.com")).toBe(false);
    expect(lineContainsHost("# 127.0.0.1 api.example.com", "api.example.com")).toBe(false);
  });

  it("encrypts and decrypts cached sudo credentials without plaintext persistence", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "9r-mitm-crypto-"));
    const manager = loadCjs("../../src/mitm/manager.js", dataDir);
    const encrypted = manager.__test.encryptPassword("correct horse battery staple");
    expect(encrypted).not.toContain("correct horse");
    expect(manager.__test.decryptPassword(encrypted)).toBe("correct horse battery staple");
  });
});

describe("tunnel input boundaries", () => {
  it("allows only official HTTPS cloudflared download hosts", async () => {
    const cloudflared = await import("../../src/lib/tunnel/cloudflare/cloudflared.js");
    expect(cloudflared.__test__.validateDownloadUrl("https://github.com/cloudflare/cloudflared/releases/latest/download/x").hostname).toBe("github.com");
    expect(() => cloudflared.__test__.validateDownloadUrl("http://github.com/x")).toThrow(/unsafe/);
    expect(() => cloudflared.__test__.validateDownloadUrl("https://evil.example/x")).toThrow(/Refusing/);
    expect(() => cloudflared.__test__.validateDownloadUrl("https://user:pass@github.com/x")).toThrow(/unsafe/);
  });

  it("normalizes safe Tailscale hostnames and rejects path/command payloads", async () => {
    const tailscale = await import("../../src/lib/tunnel/tailscale/tailscale.js");
    expect(tailscale.__test__.normalizeHostname("My-Router.example.ts.net")).toBe("my-router.example.ts.net");
    expect(() => tailscale.__test__.normalizeHostname("../../tmp/evil")).toThrow(/Invalid/);
    expect(() => tailscale.__test__.normalizeHostname("router; shutdown -h now")).toThrow(/Invalid/);
  });
});

describe("privileged source invariants", () => {
  const read = (file) => fs.readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

  it("binds the MITM listener to loopback and never kills an arbitrary port owner on startup", () => {
    const source = read("src/mitm/server.js");
    expect(source).toContain("server.listen(LOCAL_PORT, LOOPBACK_HOST");
    expect(source).not.toMatch(/function killPort\(/);
    expect(source).toContain("MITM_INSTANCE_TOKEN");
  });

  it("contains no fuzzy process-kill or shell-exec fallback in tunnel managers", () => {
    for (const file of [
      "src/lib/tunnel/tailscale/tailscale.js",
      "src/lib/tunnel/cloudflare/cloudflared.js",
      "src/lib/appUpdater.js",
    ]) {
      const source = read(file);
      expect(source).not.toMatch(/\bexecSync\s*\(/);
      expect(source).not.toMatch(/\bpkill\b/);
      expect(source).not.toMatch(/ps aux/);
    }
  });

  it("uses argv-based sudo rather than sh -c in the MITM layer", () => {
    for (const file of ["src/mitm/manager.js", "src/mitm/dns/dnsConfig.js", "src/mitm/cert/install.js"]) {
      const source = read(file);
      expect(source).not.toMatch(/["']sh["']\s*,\s*\[[^\]]*["']-c["']/);
      expect(source).not.toMatch(/\bexecSync\s*\(/);
    }
  });

  it("keeps launcher and autostart lifecycle commands shell-free", () => {
    for (const file of ["cli/cli.js", "cli/src/cli/tray/autostart.js", "cli/src/cli/tray/tray.js"]) {
      const source = read(file);
      expect(source).not.toMatch(/\bexecSync\s*\(/);
      expect(source).not.toMatch(/\bexec\s*\(/);
      expect(source).not.toMatch(/shell\s*:\s*true/);
      expect(source).not.toMatch(/ps aux/);
    }
    expect(read("cli/cli.js")).toContain("Refusing to terminate it");
  });
});
