// Detached updater process. All commands use fixed argv, all network/process
// output is bounded, and the status server remains loopback-only.

const { spawn } = require("child_process");
const http = require("http");
const net = require("net");
const path = require("path");
const fs = require("fs");
const os = require("os");

const TRUSTED_PACKAGE = "proxy-max";
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_LOG_BYTES = 5 * 1024 * 1024;
const MAX_LINE_BYTES = 8192;

function boundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

const requestedPackage = process.env.UPDATER_PKG_NAME || TRUSTED_PACKAGE;
const packageName = requestedPackage === TRUSTED_PACKAGE ? TRUSTED_PACKAGE : null;
const port = boundedInt(process.env.UPDATER_PORT, 20129, 1024, 65535);
const tailLines = boundedInt(process.env.UPDATER_TAIL_LINES, 8, 1, 100);
const maxRetries = boundedInt(process.env.UPDATER_RETRIES, 3, 1, 5);
const retryDelayMs = boundedInt(process.env.UPDATER_RETRY_DELAY_MS, 5000, 100, 60_000);
const lingerMs = boundedInt(process.env.UPDATER_LINGER_MS, 30_000, 1000, 120_000);
const waitMinMs = boundedInt(process.env.UPDATER_WAIT_MIN_MS, 3000, 0, 30_000);
const waitMaxMs = boundedInt(process.env.UPDATER_WAIT_MAX_MS, 15_000, waitMinMs, 60_000);
const waitCheckMs = boundedInt(process.env.UPDATER_WAIT_CHECK_MS, 500, 50, 5000);
const appPort = boundedInt(process.env.UPDATER_APP_PORT, 20128, 1, 65535);

function getDataDir() {
  if (process.env.DATA_DIR) return path.resolve(process.env.DATA_DIR);
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "proxy-max");
  }
  return path.join(os.homedir(), ".proxy-max");
}

const updateDir = path.join(getDataDir(), "update");
fs.mkdirSync(updateDir, { recursive: true, mode: 0o700 });
try { fs.chmodSync(updateDir, 0o700); } catch {}
const statusFile = path.join(updateDir, "status.json");
const logFile = path.join(updateDir, "install.log");

const state = {
  phase: packageName ? "starting" : "error",
  packageName: TRUSTED_PACKAGE,
  startedAt: Date.now(),
  finishedAt: packageName ? null : Date.now(),
  attempt: 0,
  maxRetries,
  done: !packageName,
  success: false,
  exitCode: null,
  error: packageName ? null : "Refusing to update an unexpected package",
  logTail: [],
};

function sanitizeLog(value) {
  return String(value)
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[credentials]@")
    .replace(/(token|password|secret|authorization)\s*[=:]\s*[^\s]+/gi, "$1=[redacted]")
    .slice(0, MAX_LINE_BYTES);
}

function rotateLogIfNeeded() {
  try {
    if (!fs.existsSync(logFile) || fs.statSync(logFile).size < MAX_LOG_BYTES) return;
    const rotated = `${logFile}.1`;
    try { fs.unlinkSync(rotated); } catch {}
    fs.renameSync(logFile, rotated);
  } catch {}
}

function pushLog(line) {
  const trimmed = sanitizeLog(line).replace(/\r?\n$/, "");
  if (!trimmed) return;
  state.logTail.push(trimmed);
  if (state.logTail.length > tailLines) state.logTail = state.logTail.slice(-tailLines);
  try {
    rotateLogIfNeeded();
    fs.appendFileSync(logFile, `${trimmed}\n`, { encoding: "utf8", mode: 0o600 });
  } catch {}
}

function persistStatus() {
  const temp = `${statusFile}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temp, statusFile);
    try { fs.chmodSync(statusFile, 0o600); } catch {}
  } catch {
    try { fs.unlinkSync(temp); } catch {}
  }
}

function setPhase(phase) {
  state.phase = phase;
  persistStatus();
}

function allowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return null;
  try {
    const parsed = new URL(origin);
    const hostOk = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1";
    return hostOk && Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80)) === appPort ? origin : false;
  } catch {
    return false;
  }
}

const server = http.createServer((req, res) => {
  const origin = allowedOrigin(req);
  if (origin === false) {
    res.statusCode = 403;
    res.end("forbidden");
    return;
  }
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method === "GET" && (req.url === "/update/status" || req.url === "/")) {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(state));
    return;
  }
  res.statusCode = 404;
  res.end("not found");
});

server.on("error", (error) => {
  state.error = `status server error: ${sanitizeLog(error.message)}`;
  persistStatus();
});

function isAppPortBusy() {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (busy) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(busy);
    };
    socket.setTimeout(300);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(appPort, "127.0.0.1");
  });
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitForAppExit() {
  setPhase("waitingForExit");
  pushLog(`[updater] waiting for app to exit (min ${Math.round(waitMinMs / 1000)}s)...`);
  await sleep(waitMinMs);
  const deadline = Date.now() + (waitMaxMs - waitMinMs);
  while (Date.now() < deadline) {
    if (!(await isAppPortBusy())) {
      pushLog(`[updater] app port :${appPort} is free, proceeding`);
      return;
    }
    await sleep(waitCheckMs);
  }
  pushLog("[updater] timeout waiting for app; proceeding");
}

function findNpm() {
  const names = process.platform === "win32" ? ["npm.cmd", "npm.exe"] : ["npm"];
  for (const dir of (process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        if (fs.statSync(candidate).isFile()) return fs.realpathSync(candidate);
      } catch {}
    }
  }
  return null;
}

function npmInvocation(npmPath) {
  if (process.platform !== "win32") return { file: npmPath, prefixArgs: [] };
  const candidates = [
    path.join(path.dirname(npmPath), "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    path.resolve(path.dirname(npmPath), "..", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  const cli = candidates.find((candidate) => {
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  });
  return cli ? { file: process.execPath, prefixArgs: [cli] } : null;
}

function killChildTree(child) {
  if (!child?.pid) return;
  try {
    if (process.platform === "win32") child.kill("SIGKILL");
    else process.kill(-child.pid, "SIGKILL");
  } catch {
    try { child.kill("SIGKILL"); } catch {}
  }
}

function runInstall() {
  if (!packageName) return finalize(false, null, state.error);
  const npm = findNpm();
  if (!npm) return finalize(false, null, "npm was not found");
  const invocation = npmInvocation(npm);
  if (!invocation) return finalize(false, null, "npm CLI runtime was not found");
  state.attempt += 1;
  setPhase("installing");
  pushLog(`[updater] attempt ${state.attempt}/${maxRetries} — npm install proxy-max@latest`);

  const args = ["install", "-g", `${TRUSTED_PACKAGE}@latest`, "--prefer-online", "--no-audit", "--no-fund"];
  const child = spawn(invocation.file, [...invocation.prefixArgs, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
    shell: false,
  });
  let settled = false;
  const finishAttempt = (error, code) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (!error && code === 0) return finalize(true, 0, null);
    pushLog(`[updater] install failed${code == null ? "" : ` (code ${code})`}`);
    if (state.attempt < maxRetries) {
      setTimeout(runInstall, retryDelayMs).unref?.();
      return;
    }
    finalize(false, code, error || `Install failed after ${maxRetries} attempts`);
  };
  const onData = (chunk) => {
    chunk.toString("utf8").split(/\r?\n/).forEach(pushLog);
    persistStatus();
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
  child.once("error", (error) => finishAttempt(sanitizeLog(error.message), null));
  child.once("close", (code) => finishAttempt(code === 0 ? null : "npm install failed", code));
  const timer = setTimeout(() => {
    killChildTree(child);
    finishAttempt("npm install timed out after 5 minutes", null);
  }, INSTALL_TIMEOUT_MS);
  timer.unref?.();
}

function openBrowser(url) {
  let command;
  let args;
  if (process.platform === "darwin") {
    command = "/usr/bin/open";
    args = [url];
  } else if (process.platform === "win32") {
    command = process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe";
    args = ["/d", "/s", "/c", "start", "", url];
  } else {
    command = ["/usr/bin/xdg-open", "/usr/local/bin/xdg-open"].find((p) => fs.existsSync(p));
    args = [url];
  }
  if (!command) return;
  try {
    const child = spawn(command, args, { shell: false, detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
  } catch {}
}

async function waitForAppAndOpenBrowser() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await isAppPortBusy()) {
      openBrowser(`http://localhost:${appPort}/dashboard`);
      pushLog("[updater] app ready; opened dashboard");
      return;
    }
    await sleep(1000);
  }
  pushLog("[updater] app did not respond within 30s");
}

function relaunchApp() {
  if (process.env.UPDATER_RELAUNCH !== "1") return;
  const cmd = process.env.UPDATER_RELAUNCH_CMD;
  if (!cmd || !path.isAbsolute(cmd)) return;
  let args;
  try { args = JSON.parse(process.env.UPDATER_RELAUNCH_ARGS || "[]"); } catch { return; }
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string" || arg.includes("\0"))) return;
  try {
    const child = spawn(cmd, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      shell: false,
      env: { ...process.env, UPDATER_RELAUNCH: "", UPDATER_RELAUNCH_CMD: "", UPDATER_RELAUNCH_ARGS: "" },
    });
    child.unref();
    pushLog(`[updater] relaunched app (pid=${child.pid})`);
    waitForAppAndOpenBrowser();
  } catch (error) {
    pushLog(`[updater] relaunch failed: ${sanitizeLog(error.message)}`);
  }
}

function finalize(success, exitCode, error) {
  state.done = true;
  state.success = success;
  state.exitCode = exitCode;
  state.error = error ? sanitizeLog(error) : null;
  state.finishedAt = Date.now();
  setPhase(success ? "done" : "error");
  if (success) relaunchApp();
  setTimeout(() => {
    try { server.close(); } catch {}
    process.exit(success ? 0 : 1);
  }, lingerMs).unref?.();
}

persistStatus();
if (packageName) {
  server.listen(port, "127.0.0.1", () => { waitForAppExit().then(runInstall, (error) => finalize(false, null, error.message)); });
} else {
  server.listen(port, "127.0.0.1", () => finalize(false, null, state.error));
}

module.exports.__test__ = { boundedInt, sanitizeLog, allowedOrigin, findNpm, npmInvocation };
