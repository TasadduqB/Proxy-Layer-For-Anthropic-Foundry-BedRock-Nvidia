import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import https from "https";
import { spawn } from "child_process";
import { execFileWithPassword } from "@/mitm/dns/dnsConfig";
import { DATA_DIR } from "@/lib/dataDir.js";
import {
  findExecutable,
  parsePort,
  processMatches,
  readProcessCommandLine,
  readPidRecord,
  runFile,
  runFileSync,
  safeErrorMessage,
  writePidRecord,
} from "@/lib/security/privilegedProcess.js";

const BIN_DIR = path.join(DATA_DIR, "bin");
const IS_MAC = os.platform() === "darwin";
const IS_LINUX = os.platform() === "linux";
const IS_WINDOWS = os.platform() === "win32";
const TAILSCALE_BIN = path.join(BIN_DIR, IS_WINDOWS ? "tailscale.exe" : "tailscale");

// Custom socket for userspace-networking mode (no root required)
const TAILSCALE_DIR = path.join(DATA_DIR, "tailscale");
export const TAILSCALE_SOCKET = path.join(TAILSCALE_DIR, "tailscaled.sock");
const DAEMON_PID_FILE = path.join(TAILSCALE_DIR, "tailscaled.pid");
const SOCKET_FLAG = IS_WINDOWS ? [] : ["--socket", TAILSCALE_SOCKET];

// System daemon socket (sudo install: apt/snap/systemd) — read-only status detection
const SYSTEM_TAILSCALE_SOCKET = IS_WINDOWS ? null : "/var/run/tailscale/tailscaled.sock";
const SYSTEM_SOCKET_FLAG = SYSTEM_TAILSCALE_SOCKET ? ["--socket", SYSTEM_TAILSCALE_SOCKET] : [];

// Well-known Windows install path
const WINDOWS_TAILSCALE_BIN = "C:\\Program Files\\Tailscale\\tailscale.exe";

// Common Unix install paths to probe synchronously (system tailscale)
const UNIX_TAILSCALE_CANDIDATES = [
  "/usr/local/bin/tailscale",
  "/opt/homebrew/bin/tailscale",
  "/usr/sbin/tailscale",   // apt package on Debian/Ubuntu
  "/usr/bin/tailscale",
  "/snap/bin/tailscale",   // Snap package
];

// ─── Cache + background refresh (avoid blocking event loop on dead daemon) ──
const PROBE_TTL_MS = 10000;
const PROBE_TIMEOUT_MS = 1500;
const COMMAND_MAX_OUTPUT_BYTES = 256 * 1024;
const INSTALL_DOWNLOAD_MAX_BYTES = 64 * 1024 * 1024;
const SCRIPT_DOWNLOAD_MAX_BYTES = 2 * 1024 * 1024;
const INSTALL_COMMAND_TIMEOUT_MS = 5 * 60 * 1000;

async function runCommand(file, args, options = {}) {
  return runFile(file, args, {
    timeoutMs: options.timeoutMs || PROBE_TIMEOUT_MS,
    maxOutputBytes: options.maxOutputBytes || COMMAND_MAX_OUTPUT_BYTES,
    env: options.env,
    cwd: options.cwd,
    input: options.input,
  });
}

function runCommandSync(file, args, options = {}) {
  return runFileSync(file, args, {
    timeoutMs: options.timeoutMs || PROBE_TIMEOUT_MS,
    maxOutputBytes: options.maxOutputBytes || COMMAND_MAX_OUTPUT_BYTES,
    env: options.env,
    stdio: options.stdio,
  });
}

const binCache = { value: undefined, fetchedAt: 0, refreshing: false };
const runningCache = { value: false, fetchedAt: 0, refreshing: false };
const loggedInCache = { value: false, fetchedAt: 0, refreshing: false };
const funnelUrlCache = { value: null, port: null, fetchedAt: 0, refreshing: false };

function fallbackBin() {
  if (fs.existsSync(TAILSCALE_BIN)) return TAILSCALE_BIN;
  if (IS_WINDOWS && fs.existsSync(WINDOWS_TAILSCALE_BIN)) return WINDOWS_TAILSCALE_BIN;
  if (!IS_WINDOWS) return UNIX_TAILSCALE_CANDIDATES.find((p) => fs.existsSync(p)) || null;
  return null;
}

function bgRefreshBin() {
  if (binCache.refreshing) return;
  binCache.refreshing = true;
  const cmd = IS_WINDOWS ? "where.exe" : "/usr/bin/which";
  runCommand(cmd, ["tailscale"], { timeoutMs: PROBE_TIMEOUT_MS, env: { ...process.env, PATH: EXTENDED_PATH } })
    .then(({ stdout }) => {
      const sys = stdout.trim();
      binCache.value = sys || fallbackBin();
    })
    .catch(() => { binCache.value = fallbackBin(); })
    .finally(() => {
      binCache.fetchedAt = Date.now();
      binCache.refreshing = false;
    });
}

// Sync getter: returns cached value, triggers background refresh if stale
export function getTailscaleBin() {
  if (Date.now() - binCache.fetchedAt > PROBE_TTL_MS) bgRefreshBin();
  // First call: synchronously probe common install paths (no exec, no event-loop block)
  if (binCache.value === undefined) {
    if (fs.existsSync(TAILSCALE_BIN)) binCache.value = TAILSCALE_BIN;
    else if (IS_WINDOWS && fs.existsSync(WINDOWS_TAILSCALE_BIN)) binCache.value = WINDOWS_TAILSCALE_BIN;
    else if (!IS_WINDOWS) {
      const found = UNIX_TAILSCALE_CANDIDATES.find((p) => fs.existsSync(p));
      binCache.value = found || null;
    } else binCache.value = null;
  }
  return binCache.value;
}

export function isTailscaleInstalled() {
  return getTailscaleBin() !== null;
}

/** Build tailscale CLI args with custom socket (no root needed) */
function tsArgs(...args) {
  return [...SOCKET_FLAG, ...args];
}

function normalizeHostname(value, label = "Tailscale hostname") {
  const hostname = String(value || "").trim().toLowerCase();
  if (hostname.length > 253 || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(hostname) || hostname.split(".").some((part) => part.length > 63 || !part)) {
    throw new Error(`Invalid ${label}`);
  }
  return hostname;
}

// Async strict probe: authoritative, awaitable (never blocks event loop). Updates cache.
export async function isTailscaleLoggedInStrict() {
  const bin = getTailscaleBin();
  if (!bin) return false;
  try {
    const { stdout } = await runCommand(bin, [...SOCKET_FLAG, "status", "--json"], {
      env: { ...process.env, PATH: EXTENDED_PATH }, timeoutMs: 5000,
    });
    const json = JSON.parse(stdout);
    // BackendState=Running + Self.Online=true → device still exists in tailnet
    const loggedIn = json.BackendState === "Running" && json.Self?.Online === true;
    loggedInCache.value = loggedIn;
    loggedInCache.fetchedAt = Date.now();
    return loggedIn;
  } catch {
    return false;
  }
}

function bgRefreshLoggedIn() {
  if (loggedInCache.refreshing) return;
  const bin = getTailscaleBin();
  if (!bin) {
    loggedInCache.value = false;
    loggedInCache.fetchedAt = Date.now();
    return;
  }
  loggedInCache.refreshing = true;
  // Dual-socket aware: probe custom socket first, then system socket
  probeStatusAsync(bin)
    .then((json) => {
      loggedInCache.value = !!json && json.BackendState === "Running" && json.Self?.Online === true;
    })
    .catch(() => { loggedInCache.value = false; })
    .finally(() => {
      loggedInCache.fetchedAt = Date.now();
      loggedInCache.refreshing = false;
    });
}

// Probe `status --json` over custom then system socket. Resolves parsed JSON or null. Never blocks event loop.
async function probeStatusAsync(bin) {
  for (const socketArgs of [SOCKET_FLAG, SYSTEM_SOCKET_FLAG]) {
    try {
      const { stdout } = await runCommand(bin, [...socketArgs, "status", "--json"], {
        env: { ...process.env, PATH: EXTENDED_PATH }, timeoutMs: PROBE_TIMEOUT_MS,
      });
      return JSON.parse(stdout);
    } catch { /* try next socket */ }
  }
  return null;
}

// Sync getter: never blocks; returns last known state, refreshes in background
export function isTailscaleLoggedIn() {
  if (Date.now() - loggedInCache.fetchedAt > PROBE_TTL_MS) bgRefreshLoggedIn();
  return loggedInCache.value;
}

function bgRefreshRunning() {
  if (runningCache.refreshing) return;
  const bin = getTailscaleBin();
  if (!bin) {
    runningCache.value = false;
    runningCache.fetchedAt = Date.now();
    return;
  }
  runningCache.refreshing = true;
  runCommand(bin, [...SOCKET_FLAG, "funnel", "status", "--json"], { timeoutMs: PROBE_TIMEOUT_MS })
    .then(({ stdout }) => {
      try {
        const json = JSON.parse(stdout);
        runningCache.value = Object.keys(json.AllowFunnel || {}).length > 0;
      } catch { runningCache.value = false; }
    })
    .catch(() => { runningCache.value = false; })
    .finally(() => {
      runningCache.fetchedAt = Date.now();
      runningCache.refreshing = false;
    });
}

// Sync getter: never blocks; returns last known state, refreshes in background
export function isTailscaleRunning() {
  if (Date.now() - runningCache.fetchedAt > PROBE_TTL_MS) bgRefreshRunning();
  return runningCache.value;
}

// Async strict probe for hot user-initiated paths (enable/connect flow).
// Awaitable, never blocks event loop; updates cache as a side effect.
export async function isTailscaleRunningStrict() {
  const bin = getTailscaleBin();
  if (!bin) return false;
  try {
    const { stdout } = await runCommand(bin, [...SOCKET_FLAG, "funnel", "status", "--json"], { timeoutMs: PROBE_TIMEOUT_MS });
    const json = JSON.parse(stdout);
    const running = Object.keys(json.AllowFunnel || {}).length > 0;
    runningCache.value = running;
    runningCache.fetchedAt = Date.now();
    return running;
  } catch {
    return false;
  }
}

// Check if a system-level tailscaled is running (uses system socket, not Proxy Max's custom one).
export function isSystemDaemonRunning() {
  if (IS_WINDOWS || !SYSTEM_TAILSCALE_SOCKET || !fs.existsSync(SYSTEM_TAILSCALE_SOCKET)) return false;
  const bin = getTailscaleBin();
  if (!bin) return false;
  try {
    const out = runCommandSync(bin, [...SYSTEM_SOCKET_FLAG, "status", "--json"], {
      env: { ...process.env, PATH: EXTENDED_PATH }, timeoutMs: PROBE_TIMEOUT_MS,
    });
    return JSON.parse(out).BackendState === "Running";
  } catch {
    return false;
  }
}

function bgRefreshFunnelUrl(port) {
  if (funnelUrlCache.refreshing) return;
  const bin = getTailscaleBin();
  if (!bin) return;
  funnelUrlCache.refreshing = true;
  runCommand(bin, [...SOCKET_FLAG, "status", "--json"], { timeoutMs: PROBE_TIMEOUT_MS })
    .then(({ stdout }) => {
      try {
        const json = JSON.parse(stdout);
        const dnsName = json.Self?.DNSName?.replace(/\.$/, "");
        funnelUrlCache.value = dnsName ? `https://${dnsName}` : null;
      } catch { /* keep prev */ }
    })
    .catch(() => { /* keep prev */ })
    .finally(() => {
      funnelUrlCache.port = port;
      funnelUrlCache.fetchedAt = Date.now();
      funnelUrlCache.refreshing = false;
    });
}

/** Get actual funnel URL from Self.DNSName (sync, authoritative — avoids hostname-conflict suffix). */
function getActualFunnelUrl() {
  const bin = getTailscaleBin();
  if (!bin) return null;
  try {
    const out = runCommandSync(bin, [...SOCKET_FLAG, "status", "--json"], {
      env: { ...process.env, PATH: EXTENDED_PATH }, timeoutMs: 5000,
    });
    const json = JSON.parse(out);
    const dnsName = json.Self?.DNSName?.replace(/\.$/, "");
    return dnsName ? `https://${dnsName}` : null;
  } catch { return null; }
}

/** Get funnel URL from tailscale status (cached, non-blocking) */
export function getTailscaleFunnelUrl(port) {
  if (Date.now() - funnelUrlCache.fetchedAt > PROBE_TTL_MS || funnelUrlCache.port !== port) {
    bgRefreshFunnelUrl(port);
  }
  return funnelUrlCache.value;
}

/**
 * Install tailscale.
 * - macOS + brew: brew install tailscale (no sudo needed)
 * - macOS no brew: download .pkg then sudo installer -pkg
 * - Linux: fetch install.sh, pipe to sudo -S sh via stdin
 * - Windows: download MSI via UAC-elevated PowerShell
 */
export async function installTailscale(sudoPassword, hostname, onProgress) {
  const log = onProgress || (() => {});
  if (IS_WINDOWS) {
    await installTailscaleWindows(log);
    return { success: true };
  }
  if (IS_MAC) await installTailscaleMac(sudoPassword, log);
  else await installTailscaleLinux(sudoPassword, log);

  log("Starting daemon...");
  await startDaemonWithPassword(sudoPassword);
  log("Logging in...");
  return startLogin(hostname);
}

const EXTENDED_PATH = `/usr/local/bin:/opt/homebrew/bin:/usr/sbin:/usr/bin:/bin:/snap/bin:${process.env.PATH || ""}`;

function hasBrew() {
  return !!findExecutable("brew", ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"]);
}

function logCommandOutput(log, result) {
  for (const line of `${result?.stdout || ""}\n${result?.stderr || ""}`.split(/\r?\n/)) {
    const clean = line.trim();
    if (clean) log(clean.slice(0, 1000));
  }
}

function downloadTailscaleFile(url, destination, maxBytes, redirects = 0) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
      if (parsed.protocol !== "https:" || !["tailscale.com", "pkgs.tailscale.com"].includes(parsed.hostname) || parsed.username || parsed.password || parsed.port || parsed.hash) {
        throw new Error("Refusing unsafe Tailscale download URL");
      }
      if (redirects > 3) throw new Error("Too many Tailscale download redirects");
    } catch (error) { reject(error); return; }

    let fd;
    try { fd = fs.openSync(destination, "wx", 0o600); } catch (error) { reject(error); return; }
    const output = fs.createWriteStream(destination, { fd, autoClose: true });
    let received = 0;
    let settled = false;
    const timer = setTimeout(() => done(new Error("Tailscale download timed out")), 120_000);
    timer.unref?.();
    const done = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        try { output.destroy(); } catch {}
        try { fs.unlinkSync(destination); } catch {}
        reject(error);
      } else resolve(destination);
    };
    const req = https.get(parsed, { headers: { "User-Agent": "proxy-max-tailscale-installer" } }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        const location = response.headers.location;
        response.resume();
        if (!location) return done(new Error("Tailscale redirect omitted Location"));
        let next;
        try { next = new URL(location, parsed); } catch (error) { return done(error); }
        output.close(() => {
          try { fs.unlinkSync(destination); } catch {}
          settled = true;
          clearTimeout(timer);
          downloadTailscaleFile(next, destination, maxBytes, redirects + 1).then(resolve, reject);
        });
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        return done(new Error(`Tailscale download failed with status ${response.statusCode}`));
      }
      const declared = Number(response.headers["content-length"] || 0);
      if (declared > maxBytes) {
        response.destroy();
        return done(new Error("Tailscale download exceeds the safety limit"));
      }
      response.on("data", (chunk) => {
        received += chunk.length;
        if (received > maxBytes) {
          response.destroy();
          done(new Error("Tailscale download exceeds the safety limit"));
        }
      });
      response.setTimeout(30_000, () => response.destroy(new Error("Tailscale download stalled")));
      response.once("error", done);
      response.pipe(output);
      output.once("finish", () => output.close(() => done()));
      output.once("error", done);
    });
    req.setTimeout(30_000, () => req.destroy(new Error("Tailscale download stalled")));
    req.once("error", done);
  });
}

function createInstallTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "proxy-max-tailscale-"));
}

async function installTailscaleMac(sudoPassword, log) {
  if (hasBrew()) {
    log("Installing via Homebrew...");
    const brew = findExecutable("brew", ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"]);
    const result = await runCommand(brew, ["install", "tailscale"], {
      timeoutMs: INSTALL_COMMAND_TIMEOUT_MS,
      maxOutputBytes: 1024 * 1024,
      env: { ...process.env, PATH: EXTENDED_PATH },
    });
    logCommandOutput(log, result);
    return;
  }

  // No brew: download .pkg and install via sudo installer
  const pkgUrl = "https://pkgs.tailscale.com/stable/tailscale-latest.pkg";
  const tempDir = createInstallTempDir();
  const pkgPath = path.join(tempDir, "tailscale.pkg");

  try {
    log("Downloading Tailscale package...");
    await downloadTailscaleFile(pkgUrl, pkgPath, INSTALL_DOWNLOAD_MAX_BYTES);
    const pkgutil = findExecutable("pkgutil", ["/usr/sbin/pkgutil", "/usr/bin/pkgutil"]);
    if (!pkgutil) throw new Error("pkgutil is required to verify the Tailscale installer");
    const signature = runCommandSync(pkgutil, ["--check-signature", pkgPath], { timeoutMs: 30_000, maxOutputBytes: 64 * 1024 });
    if (!/Developer ID Installer:\s*Tailscale Inc\./i.test(signature)) {
      throw new Error("Tailscale package signature is missing or untrusted");
    }
    log("Installing verified package...");
    const installer = findExecutable("installer", ["/usr/sbin/installer", "/usr/bin/installer"]);
    const result = await execFileWithPassword(installer, ["-pkg", pkgPath, "-target", "/"], sudoPassword, {
      timeoutMs: INSTALL_COMMAND_TIMEOUT_MS,
      maxOutputBytes: 1024 * 1024,
    });
    logCommandOutput(log, result);
  } catch (error) {
    const detail = `${error?.stderr || ""} ${error?.message || ""}`;
    if (/incorrect password|sorry, try again/i.test(detail)) throw new Error("Wrong sudo password");
    throw new Error(safeErrorMessage(error, "Tailscale package installation failed"));
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
}

async function installTailscaleLinux(sudoPassword, log) {
  if (typeof sudoPassword !== "string" || /[\0\r\n]/.test(sudoPassword) || Buffer.byteLength(sudoPassword) > 4096) {
    throw new Error("Invalid sudo password");
  }
  log("Downloading install script...");
  const tempDir = createInstallTempDir();
  const tmpScript = path.join(tempDir, `install-${crypto.randomBytes(8).toString("hex")}.sh`);
  try {
    // The official endpoint redirects to pkgs.tailscale.com; the downloader
    // rejects every other host and caps the script at 2 MiB.
    await downloadTailscaleFile("https://tailscale.com/install.sh", tmpScript, SCRIPT_DOWNLOAD_MAX_BYTES);
    const scriptContent = fs.readFileSync(tmpScript, "utf8");
    if (!/^#!\s*\/bin\/(?:ba)?sh\b/.test(scriptContent) || scriptContent.includes("\0") || !scriptContent.includes("pkgs.tailscale.com")) {
      throw new Error("Downloaded Tailscale install script failed validation");
    }
    fs.chmodSync(tmpScript, 0o700);
    log("Running verified-origin install script...");
    const shell = findExecutable("sh", ["/bin/sh", "/usr/bin/sh"]);
    const result = await execFileWithPassword(shell, [tmpScript], sudoPassword, {
      timeoutMs: INSTALL_COMMAND_TIMEOUT_MS,
      maxOutputBytes: 1024 * 1024,
    });
    logCommandOutput(log, result);
  } catch (error) {
    const detail = `${error?.stderr || ""} ${error?.message || ""}`;
    if (/incorrect password|sorry, try again/i.test(detail)) throw new Error("Wrong sudo password");
    throw new Error(safeErrorMessage(error, "Tailscale installation failed"));
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
}

async function installTailscaleWindows(log) {
  const msiUrl = "https://pkgs.tailscale.com/stable/tailscale-setup-latest-amd64.msi";
  const tempDir = createInstallTempDir();
  const msiPath = path.join(tempDir, "tailscale-setup.msi");

  try {
    log("Downloading Tailscale installer...");
    await downloadTailscaleFile(msiUrl, msiPath, INSTALL_DOWNLOAD_MAX_BYTES);
    const verifyScript = "& { param($p) $s = Get-AuthenticodeSignature -LiteralPath $p; if ($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'Tailscale Inc') { exit 17 }; $s.SignerCertificate.Subject }";
    runCommandSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", verifyScript, msiPath], { timeoutMs: 30_000 });

    log("Installing verified Tailscale package (UAC prompt may appear)...");
    const escapedPath = msiPath.replace(/'/g, "''");
    const installScript = `$p = Start-Process msiexec.exe -ArgumentList @('/i','${escapedPath}','TS_NOLAUNCH=true','/quiet','/norestart') -Verb RunAs -Wait -PassThru; exit $p.ExitCode`;
    await runCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", installScript], {
      timeoutMs: INSTALL_COMMAND_TIMEOUT_MS,
      maxOutputBytes: 128 * 1024,
    });
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }

  // Verify tailscale.exe exists after install
  log("Verifying installation...");
  const maxWait = 10000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    if (fs.existsSync(WINDOWS_TAILSCALE_BIN)) {
      log("Installation complete.");
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Installation finished but tailscale.exe not found");
}

// Self-heal: if state dir/files were previously created by root (e.g. legacy sudo daemon),
// reclaim ownership recursively so the user-mode daemon can read/write state files.
async function ensureUserOwnedDir(dir) {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      return;
    }
    const uid = process.getuid();
    const gid = process.getgid();

    // Walk dir + all entries to find any non-user-owned items
    const needsChown = (() => {
      const stack = [dir];
      while (stack.length) {
        const cur = stack.pop();
        try {
          const st = fs.statSync(cur);
          if (st.uid !== uid) return true;
          if (st.isDirectory()) {
            for (const name of fs.readdirSync(cur)) stack.push(path.join(cur, name));
          }
        } catch { /* ignore */ }
      }
      return false;
    })();

    if (!needsChown) return;

    // Try direct chown first (works when already privileged). Fallback to a
    // fixed argv passwordless-sudo invocation; never interpolate DATA_DIR.
    try {
      const chown = findExecutable("chown", ["/usr/sbin/chown", "/usr/bin/chown", "/bin/chown"]);
      runCommandSync(chown, ["-R", `${uid}:${gid}`, dir], { stdio: "ignore", timeoutMs: 3000 });
    } catch {
      try {
        const sudo = findExecutable("sudo", ["/usr/bin/sudo", "/bin/sudo", "/usr/local/bin/sudo"]);
        const chown = findExecutable("chown", ["/usr/sbin/chown", "/usr/bin/chown", "/bin/chown"]);
        runCommandSync(sudo, ["-n", "--", chown, "-R", `${uid}:${gid}`, dir], { stdio: "ignore", timeoutMs: 3000 });
      } catch {}
    }
  } catch { /* ignore */ }
}

/** Check if running daemon uses TUN mode (Funnel TLS requires TUN). */
function isDaemonTunMode() {
  const record = readPidRecord(DAEMON_PID_FILE);
  if (!record?.pid || !processMatches(record.pid, ["tailscaled", TAILSCALE_SOCKET])) return null;
  try { process.kill(record.pid, 0); } catch { return null; }
  const command = readProcessCommandLine(record.pid) || "";
  return !command.includes("--tun=userspace-networking");
}

/** Daemon process alive (independent of funnel state) — mirrors cloudflared PID check semantic. */
export function isDaemonAlive() {
  return isDaemonTunMode() !== null;
}

function daemonAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === "EPERM"; }
}

async function stopTrackedDaemon(sudoPassword = "") {
  const record = readPidRecord(DAEMON_PID_FILE);
  if (!record?.pid) return false;
  if (!daemonAlive(record.pid)) {
    try { fs.unlinkSync(DAEMON_PID_FILE); } catch {}
    return false;
  }
  const identity = ["tailscaled", TAILSCALE_SOCKET, ...(record.executable ? [record.executable] : [])];
  if (!processMatches(record.pid, identity)) {
    throw new Error("Refusing to stop a PID that is not the managed tailscaled process");
  }

  const signal = async (name) => {
    try { process.kill(record.pid, name); return; } catch (error) {
      if (error?.code !== "EPERM") return;
    }
    const kill = findExecutable("kill", ["/bin/kill", "/usr/bin/kill"]);
    if (kill) await execFileWithPassword(kill, [`-${name.replace(/^SIG/, "")}`, String(record.pid)], sudoPassword || "", { timeoutMs: 3000 });
  };

  await signal("SIGTERM");
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline && daemonAlive(record.pid)) await new Promise((resolve) => setTimeout(resolve, 100));
  if (daemonAlive(record.pid)) await signal("SIGKILL");
  if (!daemonAlive(record.pid)) {
    try { fs.unlinkSync(DAEMON_PID_FILE); } catch {}
    try { if (fs.lstatSync(TAILSCALE_SOCKET).isSocket()) fs.unlinkSync(TAILSCALE_SOCKET); } catch {}
    return true;
  }
  return false;
}

/**
 * Start tailscaled.
 * - With sudoPassword: TUN mode (root) → Funnel TLS works
 * - Without: userspace-networking fallback (no sudo, but Funnel TLS unstable)
 * State always lives in ~/.proxy-max/tailscale/ via --statedir.
 */
export async function startDaemonWithPassword(sudoPassword) {
  if (IS_WINDOWS) {
    // Windows: tailscale runs as a Windows Service. Start it then poll BackendState
    // until daemon finishes init (avoids "NoState" errors when calling funnel/up too early).
    const bin = getTailscaleBin();
    console.log("[Tailscale] win: net start Tailscale");
    try { runCommandSync("net.exe", ["start", "Tailscale"], { stdio: "ignore", timeoutMs: 10_000 }); }
    catch { /* may need admin, or already running */ }
    if (!bin) return;
    // Poll up to ~10s for backend to leave NoState
    for (let i = 0; i < 20; i++) {
      try {
        const out = runCommandSync(bin, ["status", "--json"], { timeoutMs: 2000 });
        const j = JSON.parse(out);
        if (j.BackendState && j.BackendState !== "NoState") {
          console.log(`[Tailscale] win: BackendState=${j.BackendState} after ${i*500}ms`);
          return;
        }
      } catch { /* daemon not ready */ }
      await new Promise((r) => setTimeout(r, 500));
    }
    console.log("[Tailscale] win: BackendState still NoState after poll");
    return;
  }

  const currentMode = isDaemonTunMode(); // true=TUN, false=userspace, null=not running
  // No password but a healthy TUN daemon already runs → keep TUN, never downgrade-kill it.
  const wantTun = sudoPassword ? true : currentMode === true;

  // Daemon already running in correct mode → reuse
  if (currentMode !== null && currentMode === wantTun) {
    try {
      const bin = getTailscaleBin() || "tailscale";
      runCommandSync(bin, [...SOCKET_FLAG, "status", "--json"], {
        stdio: "ignore", env: { ...process.env, PATH: EXTENDED_PATH }, timeoutMs: 3000,
      });
      return;
    } catch { /* unresponsive, restart below */ }
  }

  // Mode mismatch or unresponsive: stop only the daemon PID recorded by this
  // installation. Never use broad name-pattern termination that can stop a user's system
  // Tailscale service or another app's daemon.
  await stopTrackedDaemon(sudoPassword);

  // Reclaim folder ownership (previous root daemon may have locked it)
  await ensureUserOwnedDir(TAILSCALE_DIR);

  const tailscaledBin = findExecutable("tailscaled", [
    path.join(BIN_DIR, IS_WINDOWS ? "tailscaled.exe" : "tailscaled"),
    "/opt/homebrew/bin/tailscaled",
    "/usr/local/bin/tailscaled",
    "/usr/sbin/tailscaled",
    "/usr/bin/tailscaled",
  ]);
  if (!tailscaledBin) throw new Error("tailscaled executable was not found");
  const daemonArgs = [
    `--socket=${TAILSCALE_SOCKET}`,
    `--statedir=${TAILSCALE_DIR}`,
  ];
  if (!wantTun) daemonArgs.push("--tun=userspace-networking");

  if (wantTun) {
    // TUN mode: spawn via sudo, password via stdin. Detached so it survives parent exit.
    if (typeof sudoPassword !== "string" || /[\0\r\n]/.test(sudoPassword) || Buffer.byteLength(sudoPassword) > 4096) {
      throw new Error("Invalid sudo password");
    }
    const sudo = findExecutable("sudo", ["/usr/bin/sudo", "/bin/sudo", "/usr/local/bin/sudo"]);
    if (!sudo && !(typeof process.getuid === "function" && process.getuid() === 0)) throw new Error("sudo is required for TUN mode");
    const child = sudo ? spawn(sudo, ["-S", "-p", "", "--", tailscaledBin, ...daemonArgs], {
      detached: true,
      stdio: ["pipe", "ignore", "ignore"],
      cwd: os.tmpdir(),
      env: { ...process.env, PATH: EXTENDED_PATH },
      shell: false,
    }) : spawn(tailscaledBin, daemonArgs, {
      detached: true, stdio: "ignore", cwd: os.tmpdir(), env: { ...process.env, PATH: EXTENDED_PATH }, shell: false,
    });
    if (sudo && child.stdin) child.stdin.end(`${sudoPassword}\n`);
    writePidRecord(DAEMON_PID_FILE, { pid: child.pid, executable: tailscaledBin, startedAt: Date.now() });
    child.unref();
  } else {
    const child = spawn(tailscaledBin, daemonArgs, {
      detached: true,
      stdio: "ignore",
      cwd: os.tmpdir(),
      env: { ...process.env, PATH: EXTENDED_PATH },
      shell: false,
    });
    writePidRecord(DAEMON_PID_FILE, { pid: child.pid, executable: tailscaledBin, startedAt: Date.now() });
    child.unref();
  }

  // Wait for socket ready, bounded to 10 seconds.
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (fs.existsSync(TAILSCALE_SOCKET)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("tailscaled did not create its socket within 10 seconds");
}

/** Best-effort: ensure daemon running (used for login flow) */
function ensureDaemon() {
  startDaemonWithPassword("").catch(() => {});
}

/** Read AuthURL from `tailscale status --json` (Win exposes it there, not stdout). */
function getAuthUrlFromStatus() {
  const bin = getTailscaleBin();
  if (!bin) return null;
  try {
    const out = runCommandSync(bin, [...SOCKET_FLAG, "status", "--json"], { timeoutMs: 2000 });
    const j = JSON.parse(out);
    if (j.AuthURL) return j.AuthURL;
    return null;
  } catch { return null; }
}

/**
 * Run `tailscale up` and capture the auth URL for browser login.
 * Resolves with { authUrl } or { alreadyLoggedIn: true }.
 * On Windows, AuthURL comes from `status --json` (not stdout) — must poll status.
 */
export function startLogin(hostname) {
  const bin = getTailscaleBin();
  if (!bin) return Promise.reject(new Error("Tailscale not installed"));

  return new Promise((resolve, reject) => {
    // Ensure daemon is running (best-effort, no sudo)
    ensureDaemon();

    // Check if already logged in
    if (isTailscaleLoggedIn()) {
      resolve({ alreadyLoggedIn: true });
      return;
    }

    const args = tsArgs("up", "--accept-routes");
    if (hostname) {
      let safeHostname;
      try { safeHostname = normalizeHostname(hostname); } catch (error) { reject(error); return; }
      args.push(`--hostname=${safeHostname}`);
    }
    const child = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      windowsHide: true
    });

    let resolved = false;
    let output = "";

    const parseAuthUrl = (text) => {
      const match = text.match(/https:\/\/login\.tailscale\.com\/a\/[a-zA-Z0-9]+/);
      return match ? match[0] : null;
    };

    const finishWithUrl = (url, source) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      clearInterval(statusPoll);
      console.log(`[Tailscale] login authUrl detected (${source})`);
      child.unref();
      resolve({ authUrl: url });
    };

    // Poll status --json every 500ms — Windows exposes AuthURL only there
    const statusPoll = setInterval(() => {
      if (resolved) return;
      const url = getAuthUrlFromStatus();
      if (url) finishWithUrl(url, "status");
    }, 500);

    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      clearInterval(statusPoll);
      child.unref();
      const url = parseAuthUrl(output) || getAuthUrlFromStatus();
      if (url) resolve({ authUrl: url });
      else reject(new Error("tailscale up timed out without auth URL"));
    }, 15000);

    const handleData = (data) => {
      output = (output + data.toString()).slice(-64 * 1024);
      const url = parseAuthUrl(output);
      if (url) finishWithUrl(url, "stdout");
    };

    child.stdout.on("data", handleData);
    child.stderr.on("data", handleData);

    child.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      clearInterval(statusPoll);
      console.error(`[Tailscale] login spawn error: ${err.message}`);
      reject(err);
    });

    child.on("exit", (code) => {
      if (resolved) return;
      console.log(`[Tailscale] login exit code=${code}`);
      // Don't trust exit code alone — Win `tailscale up` exits 0 even when not logged in.
      // Let status poll continue until AuthURL appears or timeout.
      const url = parseAuthUrl(output) || getAuthUrlFromStatus();
      if (url) {
        finishWithUrl(url, "exit");
        return;
      }
      // Only resolve alreadyLoggedIn if status confirms BackendState=Running
      if (isTailscaleLoggedIn()) {
        resolved = true;
        clearTimeout(timeout);
        clearInterval(statusPoll);
        resolve({ alreadyLoggedIn: true });
        return;
      }
      // Otherwise keep polling — daemon may publish AuthURL shortly after exit
    });
  });
}

/** Start tailscale funnel for the given port */
export async function startFunnel(port) {
  const bin = getTailscaleBin();
  if (!bin) throw new Error("Tailscale not installed");
  const safePort = parsePort(port);
  if (!safePort) throw new Error("Invalid Tailscale funnel port");

  // Reset any existing funnel
  try { runCommandSync(bin, [...SOCKET_FLAG, "funnel", "--bg", "reset"], { stdio: "ignore", timeoutMs: 5000 }); } catch {}

  return new Promise((resolve, reject) => {
    const child = spawn(bin, tsArgs("funnel", "--bg", String(safePort)), {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    let resolved = false;
    let output = "";

    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      // --bg exits after setup, read actual hostname from status
      try { child.kill("SIGTERM"); } catch {}
      const url = getActualFunnelUrl() || getTailscaleFunnelUrl(safePort);
      if (url) resolve({ tunnelUrl: url });
      else reject(new Error(`Tailscale funnel timed out: ${output.trim() || "no output"}`));
    }, 30000);

    // Always resolve via Self.DNSName to get the real hostname (avoids -1 suffix from conflicts)
    const parseFunnelUrl = () => getActualFunnelUrl();

    let funnelNotEnabled = false;

    const handleData = (data) => {
      output = (output + data.toString()).slice(-64 * 1024);

      if (output.includes("Funnel is not enabled")) funnelNotEnabled = true;

      // Wait for the enable URL to arrive in a later chunk
      if (funnelNotEnabled && !resolved) {
        const enableMatch = output.match(/https:\/\/login\.tailscale\.com\/[^\s]+/);
        if (enableMatch) {
          resolved = true;
          clearTimeout(timeout);
          child.kill();
          resolve({ funnelNotEnabled: true, enableUrl: enableMatch[0] });
          return;
        }
      }

      const url = parseFunnelUrl();
      if (url && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve({ tunnelUrl: url });
      }
    };

    child.stdout.on("data", handleData);
    child.stderr.on("data", handleData);

    child.on("exit", (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      console.log(`[Tailscale] funnel exit code=${code} output="${output.trim().slice(0, 200)}"`);
      const url = parseFunnelUrl() || getTailscaleFunnelUrl(safePort);
      if (url) resolve({ tunnelUrl: url });
      else reject(new Error(`tailscale funnel failed (code ${code}): ${output.trim()}`));
    });

    child.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/** Provision TLS cert for funnel domain (required before Funnel serves HTTPS). Best-effort. */
export async function provisionCert(hostname) {
  const bin = getTailscaleBin();
  if (!bin || !hostname) return;
  const safeHostname = normalizeHostname(hostname, "Tailscale certificate hostname");
  const certsDir = path.join(TAILSCALE_DIR, "certs");
  fs.mkdirSync(certsDir, { recursive: true, mode: 0o700 });
  const certFile = path.join(certsDir, `${safeHostname}.crt`);
  const keyFile = path.join(certsDir, `${safeHostname}.key`);
  try {
    await runCommand(bin, [...SOCKET_FLAG, "cert", "--cert-file", certFile, "--key-file", keyFile, safeHostname], {
      env: { ...process.env, PATH: EXTENDED_PATH }, timeoutMs: 30_000,
    });
    try { fs.chmodSync(keyFile, 0o600); } catch {}
    console.log(`[Tailscale] cert provisioned for ${safeHostname}`);
  } catch (e) {
    console.warn(`[Tailscale] cert provision failed (non-fatal): ${e.message}`);
  }
}

/** Stop tailscale funnel */
export function stopFunnel() {
  const bin = getTailscaleBin();
  if (!bin) return;
  try { runCommandSync(bin, [...SOCKET_FLAG, "funnel", "--bg", "reset"], { stdio: "ignore", timeoutMs: 5000 }); } catch {}
}

/** Stop only the custom tailscaled daemon launched and recorded by Proxy Max. */
export async function stopDaemon(sudoPassword) {
  if (IS_WINDOWS) return; // system Windows service is user-managed
  await stopTrackedDaemon(sudoPassword || "");
}

export const __test__ = {
  downloadTailscaleFile,
  createInstallTempDir,
  stopTrackedDaemon,
  DAEMON_PID_FILE,
  INSTALL_DOWNLOAD_MAX_BYTES,
  SCRIPT_DOWNLOAD_MAX_BYTES,
  normalizeHostname,
};
