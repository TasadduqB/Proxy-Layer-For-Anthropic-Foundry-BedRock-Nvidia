"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync, spawn } = require("child_process");

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_PID = 2_147_483_647;

function parsePid(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{1,10}$/.test(text)) return null;
  const pid = Number(text);
  return Number.isSafeInteger(pid) && pid > 1 && pid <= MAX_PID ? pid : null;
}

function assertFileAndArgs(file, args) {
  if (typeof file !== "string" || !file || file.includes("\0")) throw new TypeError("Invalid executable");
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string" || arg.includes("\0"))) {
    throw new TypeError("Invalid command arguments");
  }
}

function runFile(file, args = [], options = {}) {
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
    let outputBytes = 0;
    let settled = false;
    let timer;
    const done = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    const collect = (parts) => (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      outputBytes += buf.length;
      if (outputBytes > maxOutputBytes) {
        const error = new Error("Command output limit exceeded");
        error.code = "OUTPUT_LIMIT";
        try { child.kill("SIGKILL"); } catch {}
        done(error);
        return;
      }
      parts.push(buf);
    };
    child.stdout?.on("data", collect(stdout));
    child.stderr?.on("data", collect(stderr));
    child.once("error", done);
    child.once("close", (code, signal) => {
      const result = {
        code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };
      if (code === 0) return done(null, result);
      const error = new Error(`Command exited with code ${code ?? "unknown"}`);
      error.code = "COMMAND_FAILED";
      error.exitCode = code;
      error.stderr = result.stderr;
      done(error);
    });
    timer = setTimeout(() => {
      const error = new Error(`Command timed out after ${timeoutMs}ms`);
      error.code = "COMMAND_TIMEOUT";
      try { child.kill("SIGKILL"); } catch {}
      done(error);
    }, timeoutMs);
    timer.unref?.();
    if (options.input != null && child.stdin) {
      child.stdin.on("error", () => {});
      child.stdin.end(options.input);
    }
  });
}

function runFileSync(file, args = [], options = {}) {
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

function findSystemBinary(name, candidates = []) {
  const paths = [...candidates];
  if (path.isAbsolute(name)) paths.unshift(name);
  for (const candidate of paths) {
    try {
      if (!candidate || !fs.statSync(candidate).isFile()) continue;
      if (process.platform !== "win32") fs.accessSync(candidate, fs.constants.X_OK);
      return fs.realpathSync(candidate);
    } catch {}
  }
  return null;
}

function sudoBinary() {
  if (process.platform === "win32") return null;
  return findSystemBinary("sudo", ["/usr/bin/sudo", "/bin/sudo", "/usr/local/bin/sudo"]);
}

function validatePassword(password) {
  const value = String(password ?? "");
  if (value.includes("\n") || value.includes("\r") || value.includes("\0") || Buffer.byteLength(value) > 4096) {
    throw new Error("Invalid sudo password");
  }
  return value;
}

function runWithSudo(file, args = [], password = "", options = {}) {
  assertFileAndArgs(file, args);
  const pwd = validatePassword(password);
  const sudo = sudoBinary();
  const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
  if (isRoot || !sudo) return runFile(file, args, options);
  const sudoArgs = pwd
    ? ["-S", "-p", "", "--", file, ...args]
    : ["-n", "--", file, ...args];
  const input = pwd ? Buffer.concat([Buffer.from(`${pwd}\n`), Buffer.from(options.input ?? "")]) : options.input;
  return runFile(sudo, sudoArgs, { ...options, input });
}

function canRunSudoWithoutPassword() {
  const sudo = sudoBinary();
  if (!sudo) return true;
  try {
    runFileSync(sudo, ["-n", "--", "/usr/bin/true"], { stdio: "ignore", timeoutMs: 3000 });
    return true;
  } catch {
    return false;
  }
}

function readProcessCommandLine(pid) {
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

function processMatches(pid, expectedTokens = []) {
  const command = readProcessCommandLine(pid);
  return !!command && expectedTokens.filter(Boolean).every((token) => command.includes(String(token)));
}

function safeErrorMessage(error, fallback = "Privileged operation failed") {
  const raw = String(error?.stderr || error?.message || fallback)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/(token|password|secret|authorization)\s*[=:]\s*[^\s]+/gi, "$1=[redacted]")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim();
  return raw.slice(0, 500) || fallback;
}

module.exports = {
  parsePid,
  runFile,
  runFileSync,
  runWithSudo,
  findSystemBinary,
  sudoBinary,
  validatePassword,
  canRunSudoWithoutPassword,
  readProcessCommandLine,
  processMatches,
  safeErrorMessage,
};
