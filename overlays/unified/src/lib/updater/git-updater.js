// Detached, source-checkout updater. It accepts configuration only from the
// trusted parent process, uses fixed argv (never a shell), fast-forwards a
// verified GitHub remote, rebuilds the pinned runtime, and relaunches the app.

const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");

const UPDATE_REF = "refs/proxy-max/update-candidate";
const MAX_LINE_BYTES = 8192;
const MAX_LOG_BYTES = 5 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const CAPTURE_TIMEOUT_MS = 30 * 1000;
const MAX_CAPTURE_BYTES = 128 * 1024;

function boundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function normalizeRemote(value) {
  const url = String(value || "").trim().replace(/\/+$/, "").replace(/\.git$/i, "");
  const ssh = url.match(/^git@github\.com:([^/]+)\/(.+)$/i);
  if (ssh) return `https://github.com/${ssh[1]}/${ssh[2]}`.toLowerCase();
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com" || parsed.username || parsed.password) return null;
    return `https://github.com${parsed.pathname}`.toLowerCase();
  } catch { return null; }
}

function safeBranch(value) {
  const branch = String(value || "");
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(branch) && !branch.includes("..") && !branch.includes("//") && !branch.endsWith("/")
    ? branch
    : null;
}

const sourceRootInput = process.env.GIT_UPDATER_SOURCE_ROOT;
const expectedRepository = normalizeRemote(process.env.GIT_UPDATER_REPOSITORY);
const remoteName = process.env.GIT_UPDATER_REMOTE === "origin" ? "origin" : null;
const branch = safeBranch(process.env.GIT_UPDATER_BRANCH);
const expectedRevision = /^[a-f0-9]{40}$/i.test(process.env.GIT_UPDATER_EXPECTED_REVISION || "")
  ? process.env.GIT_UPDATER_EXPECTED_REVISION.toLowerCase()
  : null;
const statusPort = boundedInt(process.env.UPDATER_PORT, 20129, 1024, 65535);
const appPort = boundedInt(process.env.UPDATER_APP_PORT, 8787, 1, 65535);
const lingerMs = boundedInt(process.env.UPDATER_LINGER_MS, 30000, 5000, 120000);
const tailLines = boundedInt(process.env.UPDATER_TAIL_LINES, 12, 1, 100);

function getDataDir() {
  if (process.env.DATA_DIR) return path.resolve(process.env.DATA_DIR);
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "proxy-max");
  }
  return path.join(os.homedir(), ".proxy-max", "unified");
}

const updateDir = path.join(getDataDir(), "update");
fs.mkdirSync(updateDir, { recursive: true, mode: 0o700 });
const statusFile = path.join(updateDir, "git-status.json");
const logFile = path.join(updateDir, "git-update.log");
const lockFile = path.join(updateDir, "git-update.lock");

const state = {
  phase: "starting",
  startedAt: Date.now(),
  finishedAt: null,
  done: false,
  success: false,
  error: null,
  currentRevision: null,
  targetRevision: expectedRevision,
  logTail: [],
};

function sanitize(value) {
  return String(value)
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[credentials]@")
    .replace(/(token|password|secret|authorization)\s*[=:]\s*[^\s]+/gi, "$1=[redacted]")
    .slice(0, MAX_LINE_BYTES);
}

function persist() {
  const temp = `${statusFile}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temp, statusFile);
  } catch { try { fs.unlinkSync(temp); } catch {} }
}

function log(line) {
  const safe = sanitize(line).trim();
  if (!safe) return;
  state.logTail.push(safe);
  state.logTail = state.logTail.slice(-tailLines);
  try {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size >= MAX_LOG_BYTES) {
      try { fs.unlinkSync(`${logFile}.1`); } catch {}
      fs.renameSync(logFile, `${logFile}.1`);
    }
    fs.appendFileSync(logFile, `${safe}\n`, { encoding: "utf8", mode: 0o600 });
  } catch {}
  persist();
}

function phase(value) { state.phase = value; persist(); }

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return null;
  try {
    const parsed = new URL(origin);
    const loopback = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
    return loopback && Number(parsed.port) === appPort ? origin : false;
  } catch { return false; }
}

const server = http.createServer((req, res) => {
  const origin = originAllowed(req);
  if (origin === false) { res.statusCode = 403; res.end("forbidden"); return; }
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
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

function findExecutable(name) {
  const names = process.platform === "win32" ? [`${name}.cmd`, `${name}.exe`, name] : [name];
  for (const directory of String(process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
    for (const candidateName of names) {
      const candidate = path.join(directory, candidateName);
      try { if (fs.statSync(candidate).isFile()) return fs.realpathSync(candidate); } catch {}
    }
  }
  return null;
}

function findNpmInvocation() {
  const npm = findExecutable("npm");
  if (!npm) return null;
  if (process.platform !== "win32" || !npm.toLowerCase().endsWith(".cmd")) {
    return { file: npm, prefix: [] };
  }
  const cliCandidates = [
    path.join(path.dirname(npm), "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    path.resolve(path.dirname(npm), "..", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  const cli = cliCandidates.find((candidate) => {
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  });
  return cli ? { file: process.execPath, prefix: [cli] } : null;
}

function isAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === "EPERM"; }
}

function acquireLock() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const lock = fs.openSync(lockFile, "wx", 0o600);
      fs.writeFileSync(lock, String(process.pid));
      fs.closeSync(lock);
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let owner = null;
      try {
        const text = fs.readFileSync(lockFile, "utf8").trim();
        if (/^\d{1,10}$/.test(text)) owner = Number(text);
      } catch {}
      if (isAlive(owner)) throw new Error("Another Proxy Max update is already running");
      try { fs.unlinkSync(lockFile); } catch {}
    }
  }
  throw new Error("Unable to acquire the update lock");
}

function killTree(child) {
  if (!child?.pid) return;
  try {
    if (process.platform === "win32") child.kill("SIGKILL");
    else process.kill(-child.pid, "SIGKILL");
  } catch { try { child.kill("SIGKILL"); } catch {} }
}

function run(file, args, cwd, label, timeoutMs = COMMAND_TIMEOUT_MS) {
  log(`[update] ${label}`);
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    let settled = false;
    const finish = (error, code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error || code !== 0) reject(error || new Error(`${label} failed with code ${code}`));
      else resolve();
    };
    const output = (chunk) => chunk.toString("utf8").split(/\r?\n/).forEach(log);
    child.stdout?.on("data", output);
    child.stderr?.on("data", output);
    child.once("error", (error) => finish(error));
    child.once("close", (code) => finish(null, code));
    const timer = setTimeout(() => {
      killTree(child);
      finish(new Error(`${label} timed out`));
    }, timeoutMs);
    timer.unref?.();
  });
}

function capture(file, args, cwd, timeoutMs = CAPTURE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, stdio: ["ignore", "pipe", "pipe"], shell: false, windowsHide: true });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const collect = (target) => (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_CAPTURE_BYTES) {
        killTree(child);
        finish(new Error("Git command output exceeded the safety limit"));
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.once("error", (error) => finish(error));
    child.once("close", (code) => code === 0
      ? finish(null, Buffer.concat(stdout).toString("utf8").trim())
      : finish(new Error(sanitize(Buffer.concat(stderr).toString("utf8")) || `command failed (${code})`)));
    const timer = setTimeout(() => {
      killTree(child);
      finish(new Error("Git command timed out"));
    }, timeoutMs);
    timer.unref?.();
  });
}

function runNpm(npm, args, root, label) {
  return run(npm.file, [...npm.prefix, ...args], root, label);
}

function appPortBusy() {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (busy) => { socket.destroy(); resolve(busy); };
    socket.setTimeout(300);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(appPort, "127.0.0.1");
  });
}

async function waitForExit() {
  phase("waiting-for-app");
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (!(await appPortBusy())) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Proxy Max did not stop in time");
}

function relaunch(root) {
  const supervisor = path.join(root, "src", "runtime", "supervisor.js");
  if (!fs.existsSync(supervisor)) { log("[update] supervisor missing; relaunch skipped"); return; }
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("GIT_UPDATER_") || key.startsWith("UPDATER_")) delete env[key];
  const child = spawn(process.execPath, [supervisor], {
    cwd: root,
    env,
    detached: true,
    stdio: "ignore",
    shell: false,
    windowsHide: true,
  });
  child.unref();
  log(`[update] relaunched Proxy Max (pid ${child.pid})`);
}

async function pipeline() {
  let root;
  let git;
  let npm;
  let before;
  let advanced = false;
  let lockAcquired = false;
  try {
    if (!sourceRootInput || !path.isAbsolute(sourceRootInput) || !expectedRepository || !remoteName || !branch || !expectedRevision) {
      throw new Error("Invalid updater configuration");
    }
    root = fs.realpathSync(sourceRootInput);
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    if (pkg?.name !== "proxy-max" || !fs.existsSync(path.join(root, ".git"))) throw new Error("Invalid Proxy Max source checkout");
    acquireLock();
    lockAcquired = true;
    git = findExecutable("git");
    npm = findNpmInvocation();
    if (!git || !npm) throw new Error("Git and npm are required for automatic updates");

    await waitForExit();
    phase("verifying");
    const actualRemote = normalizeRemote(await capture(git, ["remote", "get-url", remoteName], root));
    if (actualRemote !== expectedRepository) throw new Error("Git remote no longer matches the trusted repository");
    const dirty = await capture(git, ["status", "--porcelain=v1", "--untracked-files=normal"], root);
    if (dirty) throw new Error("Source checkout changed after the update check; update cancelled");
    before = await capture(git, ["rev-parse", "HEAD"], root);
    state.currentRevision = before;
    persist();

    phase("fetching");
    await run(git, ["fetch", "--no-tags", "--prune", remoteName, `+refs/heads/${branch}:${UPDATE_REF}`], root, "fetching trusted Git revision", 60000);
    const fetched = (await capture(git, ["rev-parse", UPDATE_REF], root)).toLowerCase();
    if (fetched !== expectedRevision) throw new Error("Remote revision changed; check for updates again");
    await run(git, ["merge-base", "--is-ancestor", before, UPDATE_REF], root, "verifying fast-forward");
    phase("updating-source");
    await run(git, ["merge", "--ff-only", UPDATE_REF], root, "fast-forwarding source");
    advanced = before !== fetched;

    phase("installing");
    await runNpm(npm, ["ci", "--no-audit", "--no-fund"], root, "installing root dependencies");
    await runNpm(npm, ["run", "unified:install"], root, "installing unified dependencies");
    phase("building");
    await runNpm(npm, ["run", "unified:build"], root, "building Proxy Max");

    state.currentRevision = fetched;
    state.success = true;
    state.done = true;
    state.finishedAt = Date.now();
    phase("done");
    relaunch(root);
  } catch (error) {
    log(`[update] ${sanitize(error?.message || error)}`);
    if (advanced && root && git && before) {
      phase("rolling-back");
      try {
        await run(git, ["reset", "--hard", before], root, "restoring previous source");
        if (npm) {
          await runNpm(npm, ["ci", "--no-audit", "--no-fund"], root, "restoring root dependencies");
          await runNpm(npm, ["run", "unified:install"], root, "restoring unified dependencies");
          await runNpm(npm, ["run", "unified:build"], root, "rebuilding previous version");
        }
      } catch (rollbackError) {
        log(`[update] rollback failed: ${sanitize(rollbackError?.message || rollbackError)}`);
      }
    }
    state.error = sanitize(error?.message || "Update failed");
    state.done = true;
    state.finishedAt = Date.now();
    phase("error");
    if (root) relaunch(root);
  } finally {
    if (lockAcquired) try { fs.unlinkSync(lockFile); } catch {}
    setTimeout(() => { try { server.close(); } catch {} process.exit(state.success ? 0 : 1); }, lingerMs).unref?.();
  }
}

persist();
server.on("error", (error) => {
  state.error = sanitize(error?.message || "Updater status server failed");
  state.done = true;
  state.finishedAt = Date.now();
  state.phase = "error";
  persist();
  process.exit(1);
});
server.listen(statusPort, "127.0.0.1", () => pipeline());

module.exports.__test__ = { boundedInt, normalizeRemote, safeBranch, originAllowed, isAlive };
