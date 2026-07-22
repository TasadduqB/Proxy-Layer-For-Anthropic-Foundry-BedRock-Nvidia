import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync, spawn } from "child_process";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_PID = 2_147_483_647;

export function parsePid(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{1,10}$/.test(text)) return null;
  const pid = Number(text);
  return Number.isSafeInteger(pid) && pid > 1 && pid <= MAX_PID ? pid : null;
}

export function parsePort(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{1,5}$/.test(text)) return null;
  const port = Number(text);
  return Number.isSafeInteger(port) && port >= 1 && port <= 65_535 ? port : null;
}

function assertFileAndArgs(file, args) {
  if (typeof file !== "string" || !file || file.includes("\0")) {
    throw new TypeError("Executable must be a non-empty string");
  }
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string" || arg.includes("\0"))) {
    throw new TypeError("Command arguments must be NUL-free strings");
  }
}

function limitedAppend(parts, chunk, state, maxBytes) {
  const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  state.bytes += buf.length;
  if (state.bytes > maxBytes) return false;
  parts.push(buf);
  return true;
}

export function runFile(file, args = [], options = {}) {
  assertFileAndArgs(file, args);
  const timeoutMs = Math.max(1, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
  const maxOutputBytes = Math.max(1024, Number(options.maxOutputBytes) || DEFAULT_MAX_OUTPUT_BYTES);

  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      detached: false,
      shell: false,
      stdio: [options.input == null ? "ignore" : "pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    const outputState = { bytes: 0 };
    let settled = false;
    let timer;

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };

    const onData = (target) => (chunk) => {
      if (limitedAppend(target, chunk, outputState, maxOutputBytes)) return;
      const error = new Error(`Command output exceeded ${maxOutputBytes} bytes`);
      error.code = "OUTPUT_LIMIT";
      try { child.kill("SIGKILL"); } catch {}
      finish(error);
    };

    child.stdout?.on("data", onData(stdout));
    child.stderr?.on("data", onData(stderr));
    child.once("error", (error) => finish(error));
    child.once("close", (code, signal) => {
      const result = {
        code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };
      if (code === 0) return finish(null, result);
      const error = new Error(`Command exited with code ${code ?? "unknown"}`);
      error.code = "COMMAND_FAILED";
      error.exitCode = code;
      error.signal = signal;
      error.stderr = result.stderr;
      finish(error);
    });

    timer = setTimeout(() => {
      const error = new Error(`Command timed out after ${timeoutMs}ms`);
      error.code = "COMMAND_TIMEOUT";
      try { child.kill("SIGKILL"); } catch {}
      finish(error);
    }, timeoutMs);
    timer.unref?.();

    if (options.input != null && child.stdin) {
      child.stdin.on("error", () => {});
      child.stdin.end(options.input);
    }
  });
}

export function runFileSync(file, args = [], options = {}) {
  assertFileAndArgs(file, args);
  return execFileSync(file, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: options.encoding ?? "utf8",
    input: options.input,
    stdio: options.stdio,
    timeout: Math.max(1, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS),
    maxBuffer: Math.max(1024, Number(options.maxOutputBytes) || DEFAULT_MAX_OUTPUT_BYTES),
    windowsHide: true,
    shell: false,
  });
}

export function findExecutable(name, candidates = []) {
  const names = [...candidates];
  if (path.isAbsolute(name)) names.unshift(name);
  for (const candidate of names) {
    if (!candidate || typeof candidate !== "string") continue;
    try {
      const stat = fs.statSync(candidate);
      if (!stat.isFile()) continue;
      if (process.platform !== "win32") fs.accessSync(candidate, fs.constants.X_OK);
      return fs.realpathSync(candidate);
    } catch {}
  }
  return null;
}

export function readPidRecord(file) {
  try {
    const raw = fs.readFileSync(file, "utf8").trim();
    if (!raw) return null;
    if (/^\d+$/.test(raw)) {
      const pid = parsePid(raw);
      return pid ? { pid, legacy: true } : null;
    }
    const parsed = JSON.parse(raw);
    const pid = parsePid(parsed?.pid);
    if (!pid) return null;
    return {
      pid,
      executable: typeof parsed.executable === "string" ? parsed.executable : null,
      token: typeof parsed.token === "string" ? parsed.token : null,
      startedAt: Number.isFinite(parsed.startedAt) ? parsed.startedAt : null,
      legacy: false,
    };
  } catch {
    return null;
  }
}

export function writePidRecord(file, record) {
  const pid = parsePid(record?.pid);
  if (!pid) throw new TypeError("Invalid PID record");
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const payload = JSON.stringify({
    pid,
    executable: record.executable || null,
    token: record.token || null,
    startedAt: record.startedAt || Date.now(),
  });
  fs.writeFileSync(temp, payload, { encoding: "utf8", mode: 0o600, flag: "wx" });
  fs.renameSync(temp, file);
  try { fs.chmodSync(file, 0o600); } catch {}
}

export function readProcessCommandLine(pid) {
  const safePid = parsePid(pid);
  if (!safePid) return null;
  try {
    if (process.platform === "linux") {
      return fs.readFileSync(`/proc/${safePid}/cmdline`).toString("utf8").replace(/\0/g, " ").trim();
    }
    if (process.platform === "win32") {
      const script = "& { param([int]$p) (Get-CimInstance Win32_Process -Filter ('ProcessId=' + $p)).CommandLine }";
      return String(runFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script, String(safePid)], { timeoutMs: 3000 })).trim();
    }
    return String(runFileSync("/bin/ps", ["-p", String(safePid), "-o", "command="], { timeoutMs: 3000 })).trim();
  } catch {
    return null;
  }
}

export function processMatches(pid, expectedTokens = []) {
  const command = readProcessCommandLine(pid);
  if (!command) return false;
  return expectedTokens.filter(Boolean).every((token) => command.includes(String(token)));
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function waitForExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !isAlive(pid);
}

export async function terminateTrackedProcess(file, expectedTokens, options = {}) {
  const record = readPidRecord(file);
  if (!record) return { stopped: false, reason: "missing" };
  if (!isAlive(record.pid)) {
    try { fs.unlinkSync(file); } catch {}
    return { stopped: false, reason: "stale" };
  }
  const identityTokens = [...(expectedTokens || [])];
  if (record.executable) identityTokens.push(record.executable);
  if (!processMatches(record.pid, identityTokens)) {
    return { stopped: false, reason: "identity_mismatch", pid: record.pid };
  }

  const graceMs = Math.max(0, Number(options.graceMs) || 1000);
  try {
    if (process.platform === "win32") {
      await runFile("taskkill.exe", ["/T", "/PID", String(record.pid)], { timeoutMs: 3000 });
    } else {
      process.kill(record.pid, "SIGTERM");
    }
  } catch {}
  if (graceMs) await waitForExit(record.pid, graceMs);
  if (isAlive(record.pid)) {
    try {
      if (process.platform === "win32") {
        await runFile("taskkill.exe", ["/F", "/T", "/PID", String(record.pid)], { timeoutMs: 3000 });
      } else {
        process.kill(record.pid, "SIGKILL");
      }
    } catch {}
  }
  if (!isAlive(record.pid)) {
    try { fs.unlinkSync(file); } catch {}
    return { stopped: true, pid: record.pid };
  }
  return { stopped: false, reason: "permission_denied", pid: record.pid };
}

export function safeErrorMessage(error, fallback = "Privileged operation failed") {
  const raw = String(error?.message || fallback)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/(token|password|secret|authorization)\s*[=:]\s*[^\s]+/gi, "$1=[redacted]")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim();
  return raw.slice(0, 500) || fallback;
}

export const __test__ = {
  assertFileAndArgs,
  limitedAppend,
  isAlive,
  waitForExit,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_OUTPUT_BYTES,
  platform: os.platform(),
};
