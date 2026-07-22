const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const net = require("net");
const https = require("https");
const crypto = require("crypto");
const { addDNSEntry, removeDNSEntry, removeAllDNSEntries, removeAllDNSEntriesSync, checkAllDNSStatus, TOOL_HOSTS, isSudoAvailable, isSudoPasswordRequired } = require("./dns/dnsConfig");
const { isAdmin } = require("./winElevated.js");

const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const { generateCert } = require("./cert/generate");
const { installCert, uninstallCert } = require("./cert/install");
const { isCertExpired } = require("./cert/rootCA");
const { DATA_DIR, MITM_DIR } = require("./paths");
const { log, err } = require("./logger");
const { LSOF_BIN } = require("./config");
const {
  findSystemBinary,
  parsePid,
  processMatches,
  runFile,
  runFileSync,
  safeErrorMessage,
  sudoBinary,
} = require("./process.js");
const LSOF_PATH = findSystemBinary(LSOF_BIN || "", ["/usr/sbin/lsof", "/usr/bin/lsof", "/sbin/lsof"]);

const DEFAULT_MITM_ROUTER_BASE = "http://localhost:20128";

async function resolveMitmRouterBaseUrl() {
  if (!_getSettings) return DEFAULT_MITM_ROUTER_BASE;
  try {
    const s = await _getSettings();
    const raw = s && s.mitmRouterBaseUrl != null ? String(s.mitmRouterBaseUrl).trim() : "";
    if (!raw) return DEFAULT_MITM_ROUTER_BASE;
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return DEFAULT_MITM_ROUTER_BASE;
    if (u.username || u.password || u.hash) return DEFAULT_MITM_ROUTER_BASE;
    return raw.replace(/\/+$/, "");
  } catch {
    return DEFAULT_MITM_ROUTER_BASE;
  }
}

const MITM_PORT = 443;
const MITM_WIN_NODE_PORT = 8443;
const PID_FILE = path.join(MITM_DIR, ".mitm.pid");
const LOCK_FILE = path.join(MITM_DIR, ".mitm.lock");
const KEY_FILE = path.join(MITM_DIR, ".credential-key");

const MITM_MAX_RESTARTS = 5;
const MITM_RESTART_DELAYS_MS = [5000, 10000, 20000, 30000, 60000];
const MITM_RESTART_RESET_MS = 60000;

let mitmRestartCount = 0;
let mitmLastStartTime = 0;
let mitmIsRestarting = false;
let mitmInstanceToken = null;

function readPidRecord() {
  try {
    const raw = fs.readFileSync(PID_FILE, "utf8").trim();
    if (/^\d+$/.test(raw)) return { pid: parsePid(raw), token: null, legacy: true };
    const parsed = JSON.parse(raw);
    return {
      pid: parsePid(parsed?.pid),
      token: typeof parsed?.token === "string" ? parsed.token : null,
      serverPath: typeof parsed?.serverPath === "string" ? parsed.serverPath : null,
      legacy: false,
    };
  } catch { return null; }
}

function writePidRecord(pid, token, serverPath) {
  const safePid = parsePid(pid);
  if (!safePid || typeof token !== "string" || token.length < 32) throw new Error("Invalid MITM process record");
  fs.mkdirSync(MITM_DIR, { recursive: true, mode: 0o700 });
  const temp = `${PID_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ pid: safePid, token, serverPath, startedAt: Date.now() }), { mode: 0o600, flag: "wx" });
  fs.renameSync(temp, PID_FILE);
  try { fs.chmodSync(PID_FILE, 0o600); } catch {}
}

function isManagedMitmRecord(record) {
  if (!record?.pid || !record.token || !isProcessAlive(record.pid)) return false;
  const expected = ["server.js"];
  if (record.serverPath) expected.push(record.serverPath);
  return processMatches(record.pid, expected);
}

function resolveBundledServerPath() {
  if (process.env.MITM_SERVER_PATH) return process.env.MITM_SERVER_PATH;
  const sibling = path.join(__dirname, "server.js");
  if (fs.existsSync(sibling)) return sibling;
  const fromCwd = path.join(process.cwd(), "src", "mitm", "server.js");
  if (fs.existsSync(fromCwd)) return fromCwd;
  const fromNext = path.join(process.cwd(), "..", "src", "mitm", "server.js");
  if (fs.existsSync(fromNext)) return fromNext;
  return fromCwd;
}

// Copy bundled server.js into DATA_DIR so MITM doesn't lock node_modules
// (prevents EBUSY on `npm i -g proxy-max@latest` while MITM is running).
function ensureRuntimeServer(bundledPath) {
  try {
    if (!bundledPath || !fs.existsSync(bundledPath)) return bundledPath;

    // Dev mode: source file has relative requires (./logger, ./config...),
    // only the bundled file inside node_modules is self-contained + safe to copy.
    if (!bundledPath.includes(`${path.sep}node_modules${path.sep}`)) {
      return bundledPath;
    }

    const runtimeDir = path.join(DATA_DIR, "runtime", "mitm");
    const runtimeServer = path.join(runtimeDir, "server.js");

    // Skip copy if sizes match (bundle unchanged since last run)
    if (fs.existsSync(runtimeServer)) {
      try {
        if (fs.statSync(bundledPath).size === fs.statSync(runtimeServer).size) return runtimeServer;
      } catch { /* recopy */ }
    }

    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.copyFileSync(bundledPath, runtimeServer);
    return runtimeServer;
  } catch (e) {
    try { log(`[MITM] runtime copy failed: ${e.message}`); } catch { /* ignore */ }
    return bundledPath;
  }
}

const SERVER_PATH = ensureRuntimeServer(resolveBundledServerPath());
const ENCRYPT_ALGO = "aes-256-gcm";
const ENCRYPT_SALT = "proxy-max-mitm-pwd";
const LEGACY_ENCRYPT_SALT = Buffer.from("OXJvdXRlci1taXRtLXB3ZA==", "base64").toString("utf8");

function getProcessUsingPort443() {
  try {
    if (IS_WIN) {
      const script = "$c = Get-NetTCPConnection -LocalPort 443 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { $c.OwningProcess } else { 0 }";
      const pidStr = runFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeoutMs: 5000 }).trim();
      const pid = parseInt(pidStr, 10);
      if (pid && pid > 4) {
        const tasklistResult = runFileSync("tasklist.exe", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { timeoutMs: 5000 });
        const processMatch = tasklistResult.match(/"([^"]+)"/);
        if (processMatch) return processMatch[1].replace(".exe", "");
      }
    } else {
      if (!LSOF_PATH) return null;
      const result = runFileSync(LSOF_PATH, ["-i", ":443"], { timeoutMs: 5000 });
      const lines = result.trim().split("\n");
      if (lines.length > 1) return lines[1].split(/\s+/)[0];
    }
  } catch {
    return null;
  }
  return null;
}

let serverProcess = null;
let serverPid = null;

function getCachedPassword() { return globalThis.__mitmSudoPassword || null; }
function setCachedPassword(pwd) { globalThis.__mitmSudoPassword = pwd; }

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EACCES";
  }
}

async function killProcess(pid, force = false, sudoPassword = null) {
  const safePid = parsePid(pid);
  if (!safePid || safePid === process.pid) return false;
  if (IS_WIN) {
    const args = [...(force ? ["/F"] : []), "/T", "/PID", String(safePid)];
    try { await runFile("taskkill.exe", args, { timeoutMs: 5000 }); return true; } catch { return false; }
  } else {
    const sig = force ? "SIGKILL" : "SIGTERM";
    try { process.kill(safePid, sig); return true; } catch (error) {
      if (error?.code !== "EPERM") return false;
    }
    const { execFileWithPassword } = require("./dns/dnsConfig");
    const kill = findSystemBinary("kill", ["/bin/kill", "/usr/bin/kill"]);
    if (!kill) return false;
    try {
      await execFileWithPassword(kill, [`-${force ? "KILL" : "TERM"}`, String(safePid)], sudoPassword || "", { timeoutMs: 5000 });
      return true;
    } catch { return false; }
  }
}

function deriveKey(salt = ENCRYPT_SALT) {
  try {
    const { machineIdSync } = require("node-machine-id");
    const raw = machineIdSync();
    return crypto.createHash("sha256").update(raw + salt).digest();
  } catch {
    fs.mkdirSync(MITM_DIR, { recursive: true, mode: 0o700 });
    let secret;
    try {
      secret = fs.readFileSync(KEY_FILE);
      if (secret.length !== 32) throw new Error("invalid key file");
      try { fs.chmodSync(KEY_FILE, 0o600); } catch {}
    } catch {
      secret = crypto.randomBytes(32);
      try {
        fs.writeFileSync(KEY_FILE, secret, { mode: 0o600, flag: "wx" });
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        secret = fs.readFileSync(KEY_FILE);
      }
    }
    return crypto.createHash("sha256").update(secret).update(salt).digest();
  }
}

function encryptPassword(plaintext) {
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENCRYPT_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptPassword(stored) {
  const decryptWithKey = (key) => {
    const [ivHex, tagHex, dataHex] = stored.split(":");
    if (!ivHex || !tagHex || !dataHex) return null;
    const decipher = crypto.createDecipheriv(ENCRYPT_ALGO, key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
  };
  try { return decryptWithKey(deriveKey()); } catch {}
  try { return decryptWithKey(deriveKey(LEGACY_ENCRYPT_SALT)); } catch {}
  // Read-only compatibility for installations that previously fell back to a
  // globally constant key when node-machine-id was unavailable.
  try { return decryptWithKey(crypto.createHash("sha256").update(ENCRYPT_SALT).digest()); } catch {}
  try { return decryptWithKey(crypto.createHash("sha256").update(LEGACY_ENCRYPT_SALT).digest()); } catch { return null; }
}

let _getSettings = null;
let _updateSettings = null;

function initDbHooks(getSettingsFn, updateSettingsFn) {
  _getSettings = getSettingsFn;
  _updateSettings = updateSettingsFn;
}

async function saveMitmSettings(enabled, password) {
  if (!_updateSettings) return;
  try {
    const updates = { mitmEnabled: enabled };
    if (password) updates.mitmSudoEncrypted = encryptPassword(password);
    await _updateSettings(updates);
  } catch (e) {
    err(`Failed to save settings: ${e.message}`);
  }
}

async function clearEncryptedPassword() {
  if (!_updateSettings) return;
  try {
    await _updateSettings({ mitmSudoEncrypted: null });
  } catch (e) {
    err(`Failed to clear encrypted password: ${e.message}`);
  }
}

async function loadEncryptedPassword() {
  if (!_getSettings) return null;
  try {
    const settings = await _getSettings();
    if (!settings.mitmSudoEncrypted) return null;
    return decryptPassword(settings.mitmSudoEncrypted);
  } catch {
    return null;
  }
}

async function saveDnsToolState(tool, enabled) {
  if (!_updateSettings || !_getSettings) return;
  try {
    const s = await _getSettings();
    const next = { ...(s.dnsToolEnabled || {}), [tool]: enabled };
    await _updateSettings({ dnsToolEnabled: next });
  } catch (e) {
    err(`Failed to save DNS state: ${e.message}`);
  }
}

async function loadDnsToolState() {
  if (!_getSettings) return {};
  try {
    const s = await _getSettings();
    return s.dnsToolEnabled || {};
  } catch {
    return {};
  }
}

/**
 * Re-apply DNS for tools previously enabled — called on app startup after MITM running.
 */
async function restoreToolDNS(sudoPassword) {
  const state = await loadDnsToolState();
  const password = sudoPassword || getCachedPassword() || await loadEncryptedPassword();
  for (const [tool, enabled] of Object.entries(state)) {
    if (!enabled || !TOOL_HOSTS[tool]) continue;
    try {
      await addDNSEntry(tool, password);
    } catch (e) {
      err(`DNS ${tool}: restore failed — ${e.message}`);
    }
  }
}

/**
 * Check if user has privilege to mutate hosts file.
 * Win: needs admin. Mac/Linux: root OR cached/encrypted sudo password.
 */
async function hasDnsPrivilege() {
  if (IS_WIN) return isAdmin();
  if (isAdmin()) return true;
  if (!isSudoPasswordRequired()) return true;
  const pwd = getCachedPassword() || await loadEncryptedPassword();
  return !!pwd;
}

function checkPort443Free() {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once("error", (err) => {
      if (err.code === "EADDRINUSE") resolve("in-use");
      else resolve("no-permission");
    });
    tester.once("listening", () => { tester.close(() => resolve("free")); });
    tester.listen(MITM_PORT, "127.0.0.1");
  });
}

function getPort443Owner(sudoPassword) {
  return new Promise(async (resolve) => {
    if (IS_WIN) {
      try {
        const script = "$c = Get-NetTCPConnection -LocalPort 443 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { $c.OwningProcess } else { 0 }";
        const result = await runFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeoutMs: 5000 });
        const pid = parsePid(result.stdout.trim());
        if (!pid || pid <= 4) return resolve(null);
        const listed = await runFile("tasklist.exe", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { timeoutMs: 5000 });
        const match = listed.stdout.match(/"([^"]+)"/);
        resolve({ pid, name: match ? match[1] : "unknown" });
      } catch { resolve(null); }
    } else {
      try {
        if (!LSOF_PATH) return resolve(null);
        const result = await runFile(LSOF_PATH, ["-nP", "-iTCP:443", "-sTCP:LISTEN", "-t"], { timeoutMs: 5000 });
        const pid = parsePid(result.stdout.trim().split("\n")[0]);
        if (!pid) return resolve(null);
        const ps = await runFile("/bin/ps", ["-p", String(pid), "-o", "comm="], { timeoutMs: 3000 });
        resolve({ pid, name: ps.stdout.trim() || "unknown" });
      } catch { resolve(null); }
    }
  });
}

async function killLeftoverMitm(sudoPassword) {
  if (serverProcess && !serverProcess.killed) {
    try { serverProcess.kill("SIGKILL"); } catch { /* ignore */ }
    serverProcess = null;
    serverPid = null;
  }
  try {
    if (fs.existsSync(PID_FILE)) {
      const record = readPidRecord();
      if (isManagedMitmRecord(record)) {
        await killProcess(record.pid, true, sudoPassword);
        await new Promise(r => setTimeout(r, 500));
      }
      fs.unlinkSync(PID_FILE);
    }
  } catch { /* ignore */ }
}

function pollMitmHealth(timeoutMs, port = MITM_PORT, instanceToken = mitmInstanceToken) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      const req = https.request(
        {
          hostname: "127.0.0.1", port, path: "/_mitm_health", method: "GET", rejectUnauthorized: false,
          headers: { "x-9r-mitm-instance": instanceToken || "" }, timeout: 1000,
        },
        (res) => {
          let body = "";
          res.on("data", (d) => { if (body.length < 4096) body += d; });
          res.on("end", () => {
            try {
              const json = JSON.parse(body);
              resolve(json.ok === true ? { ok: true, pid: json.pid || null } : null);
            } catch { resolve(null); }
          });
        }
      );
      req.on("error", () => {
        if (Date.now() < deadline) setTimeout(check, 500);
        else resolve(null);
      });
      req.on("timeout", () => req.destroy());
      req.end();
    };
    check();
  });
}

/**
 * Get full MITM status including per-tool DNS status
 */
async function getMitmStatus() {
  let running = serverProcess !== null && !serverProcess.killed;
  let pid = serverPid;

  if (!running) {
    try {
      if (fs.existsSync(PID_FILE)) {
        const record = readPidRecord();
        if (isManagedMitmRecord(record)) {
          running = true;
          pid = record.pid;
          mitmInstanceToken = record.token;
        } else {
          fs.unlinkSync(PID_FILE);
        }
      }
    } catch { /* ignore */ }
  }

  const dnsStatus = checkAllDNSStatus();
  const rootCACertPath = path.join(MITM_DIR, "rootCA.crt");
  const certExists = fs.existsSync(rootCACertPath);
  const { checkCertInstalled } = require("./cert/install");
  const certTrusted = certExists ? await checkCertInstalled(rootCACertPath) : false;

  return { running, pid, certExists, certTrusted, dnsStatus };
}

async function scheduleMitmRestart(apiKey) {
  if (mitmIsRestarting) return;
  // Set guard synchronously before any await to prevent concurrent calls
  // from passing the check above.
  mitmIsRestarting = true;

  const aliveMs = Date.now() - mitmLastStartTime;
  if (aliveMs >= MITM_RESTART_RESET_MS) mitmRestartCount = 0;

  if (mitmRestartCount >= MITM_MAX_RESTARTS) {
    err("Max restart attempts reached. Giving up.");
    mitmIsRestarting = false;
    return;
  }

  const attempt = mitmRestartCount;
  const delay = MITM_RESTART_DELAYS_MS[Math.min(attempt, MITM_RESTART_DELAYS_MS.length - 1)];
  mitmRestartCount++;

  log(`Restarting in ${delay / 1000}s... (${mitmRestartCount}/${MITM_MAX_RESTARTS})`);
  await new Promise((r) => setTimeout(r, delay));

  try {
    const settings = _getSettings ? await _getSettings() : null;
    if (settings && !settings.mitmEnabled) {
      log("MITM disabled, skipping restart");
      mitmIsRestarting = false;
      return;
    }
    const password = getCachedPassword() || await loadEncryptedPassword();
    if (!password && !IS_WIN) {
      err("No cached password, cannot auto-restart");
      mitmIsRestarting = false;
      return;
    }
    await startServer(apiKey, password);
    log("🔄 Restarted successfully");
    mitmRestartCount = 0;
    mitmIsRestarting = false;
  } catch (e) {
    err(`Restart attempt ${mitmRestartCount}/${MITM_MAX_RESTARTS} failed: ${e.message}`);
    mitmIsRestarting = false;
    // Schedule next retry
    scheduleMitmRestart(apiKey);
  }
}

/**
 * Start MITM server only (cert + server, no DNS)
 */
async function killPort443Owner(owner, sudoPassword) {
  const pid = parsePid(owner?.pid);
  if (!pid || pid <= 4 || pid === process.pid) return;
  if (IS_WIN) {
    try { await runFile("taskkill.exe", ["/F", "/T", "/PID", String(pid)], { timeoutMs: 5000 }); } catch {}
  } else {
    try {
      await killProcess(pid, true, sudoPassword);
    } catch { /* best effort */ }
  }
  await new Promise(r => setTimeout(r, 800));
}

async function startServer(apiKey, sudoPassword, forceKillPort443 = false) {
  if (!serverProcess || serverProcess.killed) {
    try {
      if (fs.existsSync(PID_FILE)) {
        const record = readPidRecord();
        if (isManagedMitmRecord(record) && await pollMitmHealth(1500, MITM_PORT, record.token)) {
          serverPid = record.pid;
          mitmInstanceToken = record.token;
          log(`♻️ Reusing existing process (PID: ${record.pid})`);
          await saveMitmSettings(true, sudoPassword);
          if (sudoPassword) setCachedPassword(sudoPassword);
          return { running: true, pid: record.pid };
        } else {
          fs.unlinkSync(PID_FILE);
        }
      }
    } catch { /* ignore */ }
  }

  if (serverProcess && !serverProcess.killed) {
    throw new Error("MITM server is already running");
  }

  // Atomically claim lock to prevent concurrent startServer across processes.
  // O_EXCL (flag: "wx") fails with EEXIST if the file already exists.
  try {
    fs.mkdirSync(MITM_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: "wx", mode: 0o600 });
  } catch (e) {
    if (e.code === "EEXIST") {
      let stale = false;
      try {
        const pid = parseInt(fs.readFileSync(LOCK_FILE, "utf-8").trim(), 10);
        stale = !pid || !isProcessAlive(pid);
      } catch { stale = true; } // unreadable lock → treat as stale
      if (!stale) throw new Error("MITM server is already starting (lock contention)");
      try { fs.unlinkSync(LOCK_FILE); } catch { /* ignore */ }
      fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: "wx", mode: 0o600 });
    } else throw e;
  }

  try {
    await killLeftoverMitm(sudoPassword);

  if (!IS_WIN) {
    const portStatus = await checkPort443Free();
    if (portStatus === "in-use" || portStatus === "no-permission") {
      const owner = await getPort443Owner(sudoPassword);
      if (owner) {
        const shortName = owner.name.includes("/")
          ? owner.name.split("/").filter(Boolean).pop()
          : owner.name;
        if (forceKillPort443) {
          log(`Killing process on port 443 (PID ${owner.pid}, name=${shortName})...`);
          await killPort443Owner(owner, sudoPassword);
        } else {
          const e = new Error(`Port 443 is already in use by "${shortName}" (PID ${owner.pid}).`);
          e.code = "PORT_443_BUSY";
          e.portOwner = { pid: owner.pid, name: shortName };
          throw e;
        }
      }
    }
  }

  // Step 1: Generate Root CA if missing or expired
  const rootCACertPath = path.join(MITM_DIR, "rootCA.crt");
  const rootCAKeyPath = path.join(MITM_DIR, "rootCA.key");
  const certExists = fs.existsSync(rootCACertPath) && fs.existsSync(rootCAKeyPath);

  if (!certExists || isCertExpired(rootCACertPath)) {
    if (certExists) {
      // Uninstall expired cert from system store before regenerating
      log("🔐 Cert expired — uninstalling old cert...");
      const password = sudoPassword || getCachedPassword() || await loadEncryptedPassword();
      try { await uninstallCert(password, rootCACertPath); } catch { /* best effort */ }
    }
    log("🔐 Generating Root CA...");
    await generateCert();
  }

  // Step 1.5: Auto-install Root CA if not trusted yet
  const { checkCertInstalled } = require("./cert/install");
  const rootCATrusted = await checkCertInstalled(rootCACertPath);
  const linuxNoSystemTrust = !IS_WIN && !IS_MAC && !isSudoAvailable();
  if (!rootCATrusted) {
    log("🔐 Cert: not trusted → installing...");
    const password = sudoPassword || getCachedPassword() || await loadEncryptedPassword();
    if (linuxNoSystemTrust) {
      log(`🔐 Cert: skipping system trust (no sudo). Install ${rootCACertPath} as a trusted CA on machines that use this proxy.`);
    } else {
      if (!password && isSudoPasswordRequired()) {
        throw new Error("Sudo password required to install Root CA certificate");
      }
      try {
        await installCert(password, rootCACertPath);
        log("🔐 Cert: ✅ trusted");
      } catch (e) {
        throw new Error(`Failed to trust certificate: ${e.message}`);
      }
    }
  } else {
    log("🔐 Cert: already trusted ✅");
  }

  // Step 2: Spawn server (Root CA already installed in Step 1.5)
  // Verify server.js exists — recopy if runtime file was deleted (antivirus/cleanup)
  let effectiveServerPath = SERVER_PATH;
  if (!effectiveServerPath || !fs.existsSync(effectiveServerPath)) {
    log(`[MITM] server.js missing at ${effectiveServerPath} → recopying`);
    effectiveServerPath = ensureRuntimeServer(resolveBundledServerPath());
    if (!effectiveServerPath || !fs.existsSync(effectiveServerPath)) {
      throw new Error(`MITM server.js not found at ${effectiveServerPath}. Reinstall proxy-max.`);
    }
  }
  const mitmRouterBase = await resolveMitmRouterBaseUrl();
  mitmInstanceToken = crypto.randomBytes(32).toString("hex");
  log(`🚀 Starting server... (router: ${mitmRouterBase})`);
  if (IS_WIN) {
    // Check port 443 — ask user before killing
    const winOwner = await getPort443Owner(sudoPassword);
    if (winOwner) {
      if (forceKillPort443) {
        log(`Killing process on port 443 (PID ${winOwner.pid}, name=${winOwner.name})...`);
        await killPort443Owner(winOwner, sudoPassword);
      } else {
        const e = new Error(`Port 443 is already in use by "${winOwner.name}" (PID ${winOwner.pid}).`);
        e.code = "PORT_443_BUSY";
        e.portOwner = { pid: winOwner.pid, name: winOwner.name };
        throw e;
      }
    }

    // Spawn directly — process already has admin rights
    // cwd=tmpdir so process doesn't lock the install dir on Windows (EBUSY on update)
    serverProcess = spawn(
      process.execPath,
      [effectiveServerPath],
      {
        detached: false,
        windowsHide: true,
        cwd: os.tmpdir(),
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          ROUTER_API_KEY: apiKey,
          NODE_ENV: "production",
          MITM_ROUTER_BASE: mitmRouterBase,
          MITM_INSTANCE_TOKEN: mitmInstanceToken,
        },
      }
    );

    if (_updateSettings) await _updateSettings({ mitmCertInstalled: true }).catch(() => { });
  } else if (isSudoAvailable()) {
    if (typeof sudoPassword !== "string" || /[\0\r\n]/.test(sudoPassword) || Buffer.byteLength(sudoPassword) > 4096) {
      throw new Error("Invalid sudo password");
    }
    const sudo = sudoBinary();
    if (!sudo) throw new Error("sudo executable not found");
    serverProcess = spawn(
      sudo, ["-S", "-p", "", "-E", "--", process.execPath, effectiveServerPath],
      {
        detached: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
        cwd: os.tmpdir(),
        env: {
          ...process.env,
          HOME: os.homedir(),
          ROUTER_API_KEY: apiKey,
          MITM_ROUTER_BASE: mitmRouterBase,
          MITM_INSTANCE_TOKEN: mitmInstanceToken,
          NODE_ENV: "production",
        },
      }
    );
    serverProcess.stdin.end(`${sudoPassword}\n`);
  } else {
    // Docker/minimal images: no sudo — same as Windows-style direct spawn
    serverProcess = spawn(process.execPath, [effectiveServerPath], {
      detached: false,
      windowsHide: true,
      cwd: os.tmpdir(),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ROUTER_API_KEY: apiKey,
        NODE_ENV: "production",
        MITM_ROUTER_BASE: mitmRouterBase,
        MITM_INSTANCE_TOKEN: mitmInstanceToken,
      },
    });
  }

  if (serverProcess) {
    serverPid = serverProcess.pid;
    writePidRecord(serverPid, mitmInstanceToken, effectiveServerPath);
    mitmLastStartTime = Date.now();
  }

  // Set NODE_EXTRA_CA_CERTS so Node-based GUI apps (Electron/AG language_server) trust MITM cert
  if (IS_MAC) {
    const rootCAPath = path.join(MITM_DIR, "rootCA.crt");
    if (fs.existsSync(rootCAPath)) {
      runFile("/bin/launchctl", ["setenv", "NODE_EXTRA_CA_CERTS", rootCAPath], { timeoutMs: 5000 })
        .then(() => log(`[launchctl] NODE_EXTRA_CA_CERTS set to ${rootCAPath}`))
        .catch((e) => log(`[launchctl] Failed to set NODE_EXTRA_CA_CERTS: ${safeErrorMessage(e)}`));
    }
  } else if (IS_WIN) {
    const rootCAPath = path.join(MITM_DIR, "rootCA.crt");
    if (fs.existsSync(rootCAPath)) {
      runFile("setx.exe", ["NODE_EXTRA_CA_CERTS", rootCAPath], { timeoutMs: 5000 })
        .then(() => log("[setx] NODE_EXTRA_CA_CERTS set for current user"))
        .catch((e) => log(`[setx] Failed to set NODE_EXTRA_CA_CERTS: ${safeErrorMessage(e)}`));
    }
  }

  let startError = null;
  if (serverProcess) {
    serverProcess.stdout.on("data", (data) => {
      // server.js already formats its own logs — print as-is
      process.stdout.write(data);
    });
    serverProcess.stderr.on("data", (data) => {
      const msg = safeErrorMessage({ message: data.toString().trim() }, "MITM child error");
      // Mac/Linux: filter sudo password prompt noise
      if (msg && (IS_WIN || (!msg.includes("Password:") && !msg.includes("password for")))) {
        err(msg);
        startError = msg;
      }
      // Detect wrong/missing password — clear cache and stop retry loop
      if (!IS_WIN && (msg.includes("incorrect password") || msg.includes("no password was provided"))) {
        setCachedPassword(null);
        clearEncryptedPassword();
        mitmIsRestarting = true; // prevent scheduleMitmRestart from firing
      }
    });
    serverProcess.on("exit", (code) => {
      log(`Server exited (code: ${code})`);
      serverProcess = null;
      serverPid = null;
      try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
      try { fs.unlinkSync(LOCK_FILE); } catch { /* ignore */ }
      // Auto-restart on unexpected exit
      if (code !== 0 && !mitmIsRestarting) scheduleMitmRestart(apiKey);
    });
  }

  const health = await pollMitmHealth(8000, MITM_PORT);
  if (!health) {
    if (serverProcess && !serverProcess.killed) {
      try { await killProcess(serverProcess.pid, true, sudoPassword); } catch {}
      serverProcess = null;
    }
    const processUsing443 = getProcessUsingPort443();
    const portInfo = processUsing443 ? ` Port 443 already in use by ${processUsing443}.` : "";
    const reason = startError || `Check sudo password or port 443 access.${portInfo}`;
    throw new Error(`MITM server failed to start. ${reason}`);
  }

  if (_updateSettings) await _updateSettings({ mitmCertInstalled: true }).catch(() => { });

  if (health.pid && parsePid(health.pid)) {
    serverPid = parsePid(health.pid);
    writePidRecord(serverPid, mitmInstanceToken, effectiveServerPath);
  }

  log(`✅ Server healthy (PID: ${serverPid || health.pid})`);

  // Log DNS status per tool
  const dnsStatus = checkAllDNSStatus();
  for (const [tool, active] of Object.entries(dnsStatus)) {
    log(`🌐 DNS ${tool}: ${active ? "✅ active" : "❌ inactive"}`);
  }

  await saveMitmSettings(true, sudoPassword);
  if (sudoPassword) setCachedPassword(sudoPassword);

  // Server is healthy — remove lock file (PID file persists as the marker)
  try { fs.unlinkSync(LOCK_FILE); } catch { /* ignore */ }

  return { running: true, pid: serverPid };
  } catch (e) {
    // Clean up lock on any failure
    try { fs.unlinkSync(LOCK_FILE); } catch { /* ignore */ }
    try {
      const record = readPidRecord();
      if (!isManagedMitmRecord(record)) fs.unlinkSync(PID_FILE);
    } catch {}
    throw e;
  }
}

/**
 * Stop MITM server — removes ALL tool DNS entries first, then kills server
 */
async function stopServer(sudoPassword) {
  // Prevent auto-restart from triggering on intentional stop
  mitmIsRestarting = true;
  mitmRestartCount = 0;
  log("⏹ Stopping server...");

  // Kill server process
  const proc = serverProcess;
  const pidToKill = proc && !proc.killed
    ? proc.pid
    : (() => { const record = readPidRecord(); return isManagedMitmRecord(record) ? record.pid : null; })();

  if (pidToKill && isProcessAlive(pidToKill)) {
    log(`Killing server (PID: ${pidToKill})...`);
    await killProcess(pidToKill, false, sudoPassword);
    await new Promise(r => setTimeout(r, 1000));
    if (isProcessAlive(pidToKill)) await killProcess(pidToKill, true, sudoPassword);
  }
  serverProcess = null;
  serverPid = null;

  if (IS_WIN) {
    const hostsFile = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "drivers", "etc", "hosts");
    const allHosts = Object.values(TOOL_HOSTS).flat();
    try {
      const { isAdmin, runElevatedPowerShell, quotePs } = require("./winElevated.js");
      if (isAdmin()) {
        // Direct fs write — bypass PowerShell to avoid parser pitfalls
        const content = fs.readFileSync(hostsFile, "utf8");
        const filtered = content.split(/\r?\n/).filter((line) => {
          const tokens = line.split("#", 1)[0].trim().split(/\s+/).slice(1);
          return !allHosts.some((host) => tokens.includes(host));
        }).join("\r\n");
        const next = filtered.replace(/[\r\n\s]+$/g, "") + "\r\n";
        if (next !== content) fs.writeFileSync(hostsFile, next, "utf8");
        try { runFileSync("ipconfig.exe", ["/flushdns"], { stdio: "ignore", timeoutMs: 5000 }); } catch {}
        log("🌐 DNS: ✅ all tool hosts removed");
      } else {
        const hostsList = allHosts.map(quotePs).join(",");
        const script = `
          $hosts = @(${hostsList})
          $lines = Get-Content -LiteralPath ${quotePs(hostsFile)}
          $filtered = $lines | Where-Object {
            $line = $_
            -not ($hosts | Where-Object { $line -match [regex]::Escape($_) })
          }
          Set-Content -LiteralPath ${quotePs(hostsFile)} -Value $filtered
          ipconfig /flushdns | Out-Null
        `;
        await runElevatedPowerShell(script);
      }
    } catch (e) { err(`Failed to clean hosts: ${e.message}`); }
  } else {
    await removeAllDNSEntries(sudoPassword);
  }

  // Unset NODE_EXTRA_CA_CERTS so apps don't keep trusting stale MITM cert
  if (IS_MAC) {
    runFile("/bin/launchctl", ["unsetenv", "NODE_EXTRA_CA_CERTS"], { timeoutMs: 5000 })
      .then(() => log("[launchctl] NODE_EXTRA_CA_CERTS unset"))
      .catch((e) => log(`[launchctl] Failed to unset NODE_EXTRA_CA_CERTS: ${safeErrorMessage(e)}`));
  } else if (IS_WIN) {
    runFile("reg.exe", ["delete", "HKCU\\Environment", "/F", "/V", "NODE_EXTRA_CA_CERTS"], { timeoutMs: 5000 })
      .then(() => log("[reg] NODE_EXTRA_CA_CERTS unset"))
      .catch((e) => log(`[reg] Failed to unset NODE_EXTRA_CA_CERTS: ${safeErrorMessage(e)}`));
  }

  try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
  try { fs.unlinkSync(LOCK_FILE); } catch { /* ignore */ }
  await saveMitmSettings(false, null);
  mitmIsRestarting = false;

  return { running: false, pid: null };
}

/**
 * Enable DNS for a specific tool (requires server running)
 */
async function enableToolDNS(tool, sudoPassword) {
  const status = await getMitmStatus();
  if (!status.running) throw new Error("MITM server is not running. Start the server first.");

  const password = sudoPassword || getCachedPassword() || await loadEncryptedPassword();
  await addDNSEntry(tool, password);
  await saveDnsToolState(tool, true);
  return { success: true };
}

/**
 * Disable DNS for a specific tool
 */
async function disableToolDNS(tool, sudoPassword) {
  const password = sudoPassword || getCachedPassword() || await loadEncryptedPassword();
  await removeDNSEntry(tool, password);
  await saveDnsToolState(tool, false);
  return { success: true };
}

/**
 * Install Root CA to system trust store (standalone, no server start)
 */
async function trustCert(sudoPassword) {
  const rootCACertPath = path.join(MITM_DIR, "rootCA.crt");
  if (!fs.existsSync(rootCACertPath)) throw new Error("Root CA not found. Start server first to generate it.");
  const { installCert } = require("./cert/install");
  if (!IS_WIN && !IS_MAC && !isSudoAvailable()) {
    log(`🔐 Cert: system trust unavailable (no sudo). Use file: ${rootCACertPath}`);
    return;
  }
  const password = sudoPassword || getCachedPassword() || await loadEncryptedPassword();
  if (!password && isSudoPasswordRequired()) throw new Error("Sudo password required to trust certificate");
  await installCert(password, rootCACertPath);
  if (password) setCachedPassword(password);
}

// Legacy aliases for backward compatibility
const startMitm = startServer;
const stopMitm = stopServer;

module.exports = {
  getMitmStatus,
  startServer,
  stopServer,
  enableToolDNS,
  disableToolDNS,
  trustCert,
  // Legacy
  startMitm,
  stopMitm,
  getCachedPassword,
  setCachedPassword,
  loadEncryptedPassword,
  clearEncryptedPassword,
  isSudoPasswordRequired,
  initDbHooks,
  restoreToolDNS,
  hasDnsPrivilege,
  removeAllDNSEntriesSync,
  __test: {
    readPidRecord,
    writePidRecord,
    isManagedMitmRecord,
    resolveMitmRouterBaseUrl,
    encryptPassword,
    decryptPassword,
  },
};
