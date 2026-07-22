import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  parsePid,
  parsePort,
  readPidRecord,
  runFile,
  safeErrorMessage,
  terminateTrackedProcess,
  writePidRecord,
} from "../../src/lib/security/privilegedProcess.js";

const children = new Set();
afterEach(() => {
  for (const child of children) {
    try { child.kill("SIGKILL"); } catch {}
  }
  children.clear();
});

describe("privileged process primitives", () => {
  it.each(["1;id", "-2", "0", "1", "2147483648", "12\n34", ""])("rejects unsafe PID %j", (value) => {
    expect(parsePid(value)).toBeNull();
  });

  it.each(["443;id", "0", "65536", "-1", "12 34", ""])("rejects unsafe port %j", (value) => {
    expect(parsePort(value)).toBeNull();
  });

  it("passes metacharacters as a literal argv element without invoking a shell", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "9r-argv-"));
    const marker = path.join(dir, "pwned");
    const literal = `$(touch ${marker})`;
    const result = await runFile(process.execPath, ["-e", "process.stdout.write(process.argv[1])", literal]);
    expect(result.stdout).toBe(literal);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("kills a command that exceeds the output bound", async () => {
    await expect(runFile(process.execPath, ["-e", "process.stdout.write('x'.repeat(10000))"], {
      maxOutputBytes: 1024,
    })).rejects.toMatchObject({ code: "OUTPUT_LIMIT" });
  });

  it("kills a command at its timeout", async () => {
    await expect(runFile(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      timeoutMs: 50,
    })).rejects.toMatchObject({ code: "COMMAND_TIMEOUT" });
  });

  it("writes atomic owner-only PID records", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "9r-pid-"));
    const file = path.join(dir, "service.pid");
    writePidRecord(file, { pid: process.pid, executable: process.execPath, token: "test" });
    expect(readPidRecord(file)).toMatchObject({ pid: process.pid, executable: process.execPath, token: "test" });
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it("refuses to terminate a tracked PID when command identity does not match", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
    children.add(child);
    await new Promise((resolve) => child.once("spawn", resolve));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "9r-pid-mismatch-"));
    const file = path.join(dir, "service.pid");
    writePidRecord(file, { pid: child.pid, executable: "/definitely/not/the/process" });
    const result = await terminateTrackedProcess(file, ["cloudflared"]);
    expect(result).toMatchObject({ stopped: false, reason: "identity_mismatch", pid: child.pid });
    expect(() => process.kill(child.pid, 0)).not.toThrow();
  });

  it("redacts common secret assignments from errors", () => {
    expect(safeErrorMessage(new Error("token=abc password:xyz"))).toBe("token=[redacted] password=[redacted]");
  });
});
