import fs from "fs";
import path from "path";
import https from "https";
import os from "os";
import { spawn } from "child_process";
import { savePid, loadPidRecord, clearPid } from "./pid.js";
import { DATA_DIR } from "@/lib/dataDir.js";
import { parsePort, processMatches, runFileSync } from "@/lib/security/privilegedProcess.js";

const BIN_DIR = path.join(DATA_DIR, "bin");
const BINARY_NAME = "cloudflared";
const IS_WINDOWS = os.platform() === "win32";
const BIN_NAME = IS_WINDOWS ? `${BINARY_NAME}.exe` : BINARY_NAME;
const BIN_PATH = path.join(BIN_DIR, BIN_NAME);
const DEFAULT_QUICK_TUNNEL_PROTOCOL = "http2";
const QUICK_TUNNEL_PROTOCOLS = new Set(["http2", "quic", "auto"]);

const GITHUB_BASE_URL = "https://github.com/cloudflare/cloudflared/releases/latest/download";
const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const DOWNLOAD_IDLE_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "github-releases.githubusercontent.com",
]);

const PLATFORM_MAPPINGS = {
  darwin: {
    x64: "cloudflared-darwin-amd64.tgz",
    arm64: "cloudflared-darwin-arm64.tgz"
  },
  win32: {
    x64: "cloudflared-windows-amd64.exe",
    ia32: "cloudflared-windows-386.exe",
    arm64: "cloudflared-windows-386.exe"
  },
  linux: {
    x64: "cloudflared-linux-amd64",
    arm64: "cloudflared-linux-arm64"
  }
};

// Fallback order: prefer smallest/most-compatible binary per platform
const PLATFORM_FALLBACK = {
  darwin: "cloudflared-darwin-amd64.tgz",
  win32: "cloudflared-windows-386.exe",
  linux: "cloudflared-linux-amd64"
};

function getDownloadUrl() {
  const platform = os.platform();
  const arch = os.arch();

  const platformMapping = PLATFORM_MAPPINGS[platform];
  if (!platformMapping) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  const binaryName = platformMapping[arch] || PLATFORM_FALLBACK[platform];
  return `${GITHUB_BASE_URL}/${binaryName}`;
}

// Download state — shared so status API can read it
const dlState = { downloading: false, progress: 0 };

export function getDownloadStatus() {
  return { downloading: dlState.downloading, progress: dlState.progress };
}

function validateDownloadUrl(value) {
  const parsed = value instanceof URL ? value : new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.hash) {
    throw new Error("Refusing an unsafe cloudflared download URL");
  }
  if (!ALLOWED_DOWNLOAD_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error(`Refusing cloudflared download redirect to ${parsed.hostname}`);
  }
  return parsed;
}

function downloadFile(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = validateDownloadUrl(url); } catch (error) { reject(error); return; }
    if (redirects > MAX_REDIRECTS) { reject(new Error("Too many cloudflared download redirects")); return; }
    let fd;
    try { fd = fs.openSync(dest, "wx", 0o600); } catch (error) { reject(error); return; }
    const file = fs.createWriteStream(dest, { fd, autoClose: true });
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimer);
      if (error) {
        try { file.destroy(); } catch {}
        try { fs.unlinkSync(dest); } catch {}
        dlState.downloading = false;
        dlState.progress = 0;
        reject(error);
      } else resolve(value);
    };
    const totalTimer = setTimeout(() => finish(new Error("cloudflared download timed out")), DOWNLOAD_TIMEOUT_MS);
    totalTimer.unref?.();

    const request = https.get(parsed, { headers: { "User-Agent": "proxy-max-cloudflared-installer" } }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        const location = response.headers.location;
        response.resume();
        if (!location) return finish(new Error("cloudflared redirect omitted Location"));
        let next;
        try { next = validateDownloadUrl(new URL(location, parsed)); } catch (error) { return finish(error); }
        file.close(() => {
          try { fs.unlinkSync(dest); } catch {}
          settled = true;
          clearTimeout(totalTimer);
          downloadFile(next, dest, redirects + 1).then(resolve, reject);
        });
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        return finish(new Error(`Download failed with status ${response.statusCode}`));
      }

      const totalBytes = parseInt(response.headers["content-length"], 10) || 0;
      if (totalBytes > MAX_DOWNLOAD_BYTES) {
        response.destroy();
        return finish(new Error("cloudflared download exceeds the 200 MiB safety limit"));
      }
      let receivedBytes = 0;
      dlState.downloading = true;
      dlState.progress = 0;

      response.on("data", (chunk) => {
        receivedBytes += chunk.length;
        if (receivedBytes > MAX_DOWNLOAD_BYTES) {
          response.destroy();
          finish(new Error("cloudflared download exceeds the 200 MiB safety limit"));
          return;
        }
        if (totalBytes > 0) dlState.progress = Math.round((receivedBytes / totalBytes) * 100);
      });
      response.setTimeout(DOWNLOAD_IDLE_TIMEOUT_MS, () => response.destroy(new Error("cloudflared download stalled")));
      response.once("error", finish);

      response.pipe(file);

      file.on("finish", () => {
        dlState.downloading = false;
        dlState.progress = 100;
        file.close(() => finish(null, dest));
      });

      file.on("error", finish);
    });
    request.setTimeout(DOWNLOAD_IDLE_TIMEOUT_MS, () => request.destroy(new Error("cloudflared download stalled")));
    request.on("error", finish);
  });
}

const MIN_BINARY_SIZE = 1024 * 1024; // 1MB - cloudflared is ~30MB+

// Validate binary is executable on current platform and not truncated
function isValidBinary(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size < MIN_BINARY_SIZE) return false;
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    const magic = buf.toString("hex");
    if (IS_WINDOWS) return magic.startsWith("4d5a"); // PE (MZ)
    if (os.platform() === "darwin") return magic.startsWith("cffaedfe") || magic.startsWith("cefaedfe");
    return magic.startsWith("7f454c46"); // ELF (Linux)
  } catch {
    return false;
  }
}

let downloadPromise = null;

export async function ensureCloudflared() {
  if (downloadPromise) return downloadPromise;
  downloadPromise = _ensureCloudflared().finally(() => { downloadPromise = null; });
  return downloadPromise;
}

async function _ensureCloudflared() {
  if (!fs.existsSync(BIN_DIR)) {
    fs.mkdirSync(BIN_DIR, { recursive: true, mode: 0o700 });
  }
  try { fs.chmodSync(BIN_DIR, 0o700); } catch {}

  // Clean up incomplete downloads from previous runs
  const tmpPath = `${BIN_PATH}.tmp`;
  if (fs.existsSync(tmpPath)) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }

  if (fs.existsSync(BIN_PATH)) {
    if (!isValidBinary(BIN_PATH)) {
      console.log("[cloudflared] Invalid binary detected, re-downloading...");
      fs.unlinkSync(BIN_PATH);
    } else {
      if (!IS_WINDOWS) fs.chmodSync(BIN_PATH, "755");
      return BIN_PATH;
    }
  }

  const url = getDownloadUrl();
  const isArchive = url.endsWith(".tgz");
  const downloadDest = isArchive ? path.join(BIN_DIR, "cloudflared.tgz.tmp") : tmpPath;

  await downloadFile(url, downloadDest);

  if (isArchive) {
    const tar = ["/usr/bin/tar", "/bin/tar"].find((candidate) => fs.existsSync(candidate));
    if (!tar) throw new Error("tar is required to unpack cloudflared");
    const listing = String(runFileSync(tar, ["-tzf", downloadDest], { timeoutMs: 30_000, maxOutputBytes: 64 * 1024 }));
    const entries = listing.split(/\r?\n/).filter(Boolean);
    if (entries.length !== 1 || path.isAbsolute(entries[0]) || entries[0].split(/[\\/]+/).includes("..") || path.basename(entries[0]) !== BINARY_NAME) {
      throw new Error("cloudflared archive contains unexpected paths");
    }
    const extractDir = fs.mkdtempSync(path.join(BIN_DIR, ".extract-"));
    try {
      runFileSync(tar, ["-xzf", downloadDest, "-C", extractDir, "--", entries[0]], { timeoutMs: 30_000, maxOutputBytes: 64 * 1024 });
      const extracted = path.join(extractDir, entries[0]);
      if (!isValidBinary(extracted)) throw new Error("Downloaded cloudflared archive did not contain a valid binary");
      fs.renameSync(extracted, BIN_PATH);
    } finally {
      try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch {}
      try { fs.unlinkSync(downloadDest); } catch {}
    }
  } else {
    if (!isValidBinary(downloadDest)) {
      try { fs.unlinkSync(downloadDest); } catch {}
      throw new Error("Downloaded cloudflared file is not a valid binary");
    }
    fs.renameSync(downloadDest, BIN_PATH);
  }

  if (!IS_WINDOWS) {
    fs.chmodSync(BIN_PATH, "755");
  }

  return BIN_PATH;
}

let cloudflaredProcess = null;
let unexpectedExitHandler = null;
let intentionalKill = false; // suppress unexpected-exit callback during deliberate kill

/** Register a callback to be called when cloudflared exits unexpectedly after connecting */
export function setUnexpectedExitHandler(handler) {
  unexpectedExitHandler = handler;
}

export async function spawnCloudflared(tunnelToken) {
  if (typeof tunnelToken !== "string" || !tunnelToken.trim() || /[\0\r\n]/.test(tunnelToken) || tunnelToken.length > 16_384) {
    throw new Error("Invalid cloudflared tunnel token");
  }
  const binaryPath = await ensureCloudflared();

  const child = spawn(binaryPath, ["tunnel", "run", "--dns-resolver-addrs", "1.1.1.1:53", "--token", tunnelToken], {
    detached: false,
    windowsHide: true,
    cwd: os.tmpdir(),
    stdio: ["ignore", "pipe", "pipe"]
  });

  cloudflaredProcess = child;
  savePid(child.pid, binaryPath);

  return new Promise((resolve, reject) => {
    let connectionCount = 0;
    let resolved = false;
    const timeout = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch {}
      resolved = true;
      clearPid(child.pid);
      reject(new Error("cloudflared did not register a tunnel connection within 90 seconds"));
    }, 90000);

    const handleLog = (data) => {
      const msg = data.toString();
      // Count exact occurrences in this chunk (each chunk may contain multiple lines)
      const matches = msg.match(/Registered tunnel connection/g);
      if (matches) {
        connectionCount += matches.length;
        if (connectionCount >= 4 && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve(child);
        }
      }
    };

    child.stdout.on("data", handleLog);
    child.stderr.on("data", handleLog);

    child.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(err);
      }
    });

    child.on("exit", (code, signal) => {
      cloudflaredProcess = null;
      clearPid(child.pid);
      const wasConnected = resolved; // true = already connected successfully
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        // Collect stderr output for better error diagnosis
        let stderrOutput = "";
        if (child.stderr && !child.stderr.destroyed) {
          // Try to read any buffered stderr (may not have all output but helps with common errors)
          stderrOutput = " Check cloudflared logs for details.";
        }
        if (code === 1) {
          // Common exit code 1 issues: invalid token, auth failure, network issues
          reject(new Error(`cloudflared exited with code ${code}${stderrOutput} Ensure your tunnel token is valid and network is reachable.`));
        } else if (code === 2) {
          reject(new Error(`cloudflared exited with code ${code}${stderrOutput} Check if required arguments are correct.`));
        } else {
          reject(new Error(`cloudflared exited with code ${code}${stderrOutput}`));
        }
        return;
      }
      // Watchdog (initializeApp) handles recovery — no auto-reconnect here
      if (intentionalKill) { intentionalKill = false; return; }
      if (wasConnected && unexpectedExitHandler) unexpectedExitHandler();
    });
  });
}

/**
 * Spawn cloudflared quick tunnel (no account needed)
 * Returns the generated trycloudflare.com URL
 */
export async function spawnQuickTunnel(localPort, onUrlUpdate) {
  const safePort = parsePort(localPort);
  if (!safePort) throw new Error("Invalid local tunnel port");
  const binaryPath = await ensureCloudflared();

  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "cloudflared-quick-"));
  const configPath = path.join(configDir, "config.yml");
  // Avoid using default ~/.cloudflared/config.yml, which can conflict with quick tunnel behavior.
  fs.writeFileSync(configPath, "# quick-tunnel config placeholder\n", "utf8");

  let isCleaned = false;
  const cleanup = () => {
    if (isCleaned) return;
    isCleaned = true;
    try {
      fs.rmSync(configDir, { recursive: true, force: true });
    } catch (e) { /* ignore */ }
  };

  const requestedProtocol = String(process.env.TUNNEL_TRANSPORT_PROTOCOL || process.env.CLOUDFLARED_PROTOCOL || DEFAULT_QUICK_TUNNEL_PROTOCOL).trim().toLowerCase();
  const tunnelProtocol = QUICK_TUNNEL_PROTOCOLS.has(requestedProtocol) ? requestedProtocol : DEFAULT_QUICK_TUNNEL_PROTOCOL;
  const child = spawn(binaryPath, ["tunnel", "--url", `http://127.0.0.1:${safePort}`, "--config", configPath, "--no-autoupdate", "--retries", "99"], {
    detached: false,
    windowsHide: true,
    cwd: os.tmpdir(),
    env: {
      ...process.env,
      TUNNEL_TRANSPORT_PROTOCOL: tunnelProtocol,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  cloudflaredProcess = child;
  savePid(child.pid, binaryPath);

  return new Promise((resolve, reject) => {
    let resolved = false;
    // Keep a small tail of raw cloudflared logs to surface real failure causes
    let logTail = "";

    function getQuickTunnelUrlFromLog(message) {
      // cloudflared logs may contain "api.trycloudflare.com" as well,
      // but that is NOT the quick-tunnel endpoint we need.
      const regex = /https:\/\/([a-z0-9-]+)\.trycloudflare\.com/gi;
      const candidates = [];

      for (const match of message.matchAll(regex)) {
        const host = match[1];
        if (host === "api") continue;
        candidates.push(`https://${host}.trycloudflare.com`);
      }

      if (!candidates.length) return null;
      return candidates[candidates.length - 1];
    }

    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      try { child.kill("SIGTERM"); } catch {}
      clearPid(child.pid);
      cleanup();
      reject(new Error(`Quick tunnel timed out. Last log: ${logTail.slice(-800) || "(empty)"}`));
    }, 90000);

    let lastUrl = null;

    const handleLog = (data) => {
      const msg = data.toString();
      logTail = (logTail + msg).slice(-4000);
      const tunnelUrl = getQuickTunnelUrlFromLog(msg);
      if (!tunnelUrl) return;

      if (!resolved) {
        // First URL — resolve the promise, do NOT call onUrlUpdate (caller handles initial register)
        resolved = true;
        lastUrl = tunnelUrl;
        clearTimeout(timeout);
        cleanup();
        console.log(`[Tunnel] cloudflared URL: ${tunnelUrl}`);
        resolve({ child, tunnelUrl });
        return;
      }

      // URL changed after initial connect — notify caller to re-register
      if (tunnelUrl !== lastUrl) {
        console.log(`[Tunnel] cloudflared URL changed: ${tunnelUrl}`);
        lastUrl = tunnelUrl;
        if (onUrlUpdate) onUrlUpdate(tunnelUrl);
      }
    };

    child.stdout.on("data", handleLog);
    child.stderr.on("data", handleLog);

    child.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      cleanup();
      reject(err);
    });

    child.on("exit", (code, signal) => {
      cloudflaredProcess = null;
      clearPid(child.pid);
      // Deliberate kill (restart/disable) — exit silently, no error noise
      if (intentionalKill) {
        intentionalKill = false;
        clearTimeout(timeout);
        cleanup();
        if (!resolved) { resolved = true; reject(new Error("cloudflared killed")); }
        return;
      }
      console.log(`[Tunnel] cloudflared exit code=${code} signal=${signal}`);
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        cleanup();
        const tail = logTail.slice(-600).trim() || "(empty)";
        if (code === 1) {
          reject(new Error(`cloudflared quick tunnel exited (code 1). Common causes: (1) outbound port 7844 (TCP/UDP) blocked, (2) TryCloudflare service issue, (3) cannot reach 127.0.0.1:${safePort}, (4) protocol (http2/quic) blocked by network. Last log: ${tail}`));
        } else if (code === 2) {
          reject(new Error(`cloudflared exited (code 2). Bad arguments. Last log: ${tail}`));
        } else {
          reject(new Error(`cloudflared exited (code ${code}). Last log: ${tail}`));
        }
        return;
      }
      if (unexpectedExitHandler) unexpectedExitHandler();
      cleanup();
    });
  });
}

export function killCloudflared() {
  intentionalKill = true;
  if (cloudflaredProcess) {
    try {
      cloudflaredProcess.kill("SIGTERM");
    } catch (e) { /* ignore */ }
    cloudflaredProcess = null;
  }

  const record = loadPidRecord();
  if (record?.pid) {
    try {
      const expected = record.executable || BINARY_NAME;
      if (processMatches(record.pid, [expected])) process.kill(record.pid, "SIGTERM");
    } catch (e) { /* ignore */ }
    clearPid(record.pid);
  }
}

export function isCloudflaredRunning() {
  const record = loadPidRecord();
  if (!record?.pid) return false;
  try {
    process.kill(record.pid, 0);
    const expected = record.executable || BINARY_NAME;
    return processMatches(record.pid, [expected]);
  } catch (e) {
    clearPid(record.pid);
    return false;
  }
}

export const __test__ = {
  validateDownloadUrl,
  getDownloadUrl,
  isValidBinary,
  MAX_DOWNLOAD_BYTES,
  MAX_REDIRECTS,
  ALLOWED_DOWNLOAD_HOSTS,
};
