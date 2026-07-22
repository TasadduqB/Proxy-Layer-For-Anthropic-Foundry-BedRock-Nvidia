const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { log, err } = require("../logger");
const { TOOL_HOSTS } = require("../../shared/constants/mitmToolHosts.js");
const { runElevatedPowerShell, isAdmin } = require("../winElevated.js");
const {
  findSystemBinary,
  runFileSync,
  runWithSudo,
  safeErrorMessage,
  sudoBinary,
} = require("../process.js");

/**
 * Atomic-ish write for Windows hosts file with rollback on failure.
 * Strategy: write `.new` sibling → rename current to `.bak` → rename `.new` to target.
 * If anything fails mid-way, restore from `.bak`. Same-volume renames are atomic on NTFS.
 */
function atomicWriteHostsWin(target, originalContent, newContent) {
  const nonce = crypto.randomBytes(8).toString("hex");
  const tmpNew = `${target}.proxy-max.${nonce}.new`;
  const tmpBak = `${target}.proxy-max.${nonce}.bak`;
  try {
    fs.writeFileSync(tmpNew, newContent, { encoding: "utf8", flag: "wx" });
    fs.renameSync(target, tmpBak);
    try {
      fs.renameSync(tmpNew, target);
    } catch (e) {
      // Rollback: restore original
      try { fs.renameSync(tmpBak, target); } catch { fs.writeFileSync(target, originalContent, "utf8"); }
      throw e;
    }
    try { fs.unlinkSync(tmpBak); } catch { /* best effort */ }
  } finally {
    try { fs.unlinkSync(tmpNew); } catch { /* already moved or never created */ }
  }
}

const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const HOSTS_FILE = IS_WIN
  ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "drivers", "etc", "hosts")
  : "/etc/hosts";

/** True when `sudo` exists (e.g. missing on minimal Docker images like Alpine). */
function isSudoAvailable() {
  return !IS_WIN && !!sudoBinary();
}

function canRunSudoWithoutPassword() {
  return IS_WIN || !isSudoAvailable() || require("../process.js").canRunSudoWithoutPassword();
}

function isSudoPasswordRequired() {
  return !IS_WIN && isSudoAvailable() && !canRunSudoWithoutPassword();
}

/**
 * Execute an executable with an argv array and optional sudo password.
 * Shell command strings are intentionally unsupported.
 */
function execFileWithPassword(file, args, password, options = {}) {
  return runWithSudo(file, args, password, options);
}

/**
 * Trim trailing blank lines/whitespace, ensure file ends with exactly one newline.
 */
function normalizeHostsContent(content) {
  const eol = IS_WIN ? "\r\n" : "\n";
  return content.replace(/[\r\n\s]+$/g, "") + eol;
}

/**
 * Flush DNS cache (macOS/Linux)
 */
async function flushDNS(sudoPassword) {
  if (IS_WIN) return; // Windows flushes inline via ipconfig
  if (IS_MAC) {
    const dscacheutil = findSystemBinary("dscacheutil", ["/usr/bin/dscacheutil"]);
    const killall = findSystemBinary("killall", ["/usr/bin/killall"]);
    if (dscacheutil) await execFileWithPassword(dscacheutil, ["-flushcache"], sudoPassword, { timeoutMs: 5000 });
    if (killall) await execFileWithPassword(killall, ["-HUP", "mDNSResponder"], sudoPassword, { timeoutMs: 5000 });
  } else {
    const resolvectl = findSystemBinary("resolvectl", ["/usr/bin/resolvectl", "/bin/resolvectl"]);
    if (resolvectl) {
      try { await execFileWithPassword(resolvectl, ["flush-caches"], sudoPassword, { timeoutMs: 5000 }); } catch {}
    }
  }
}

function lineContainsHost(line, host) {
  const content = String(line).split("#", 1)[0].trim();
  if (!content) return false;
  return content.split(/\s+/).slice(1).includes(host);
}

async function replaceHostsUnix(content, sudoPassword) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-max-hosts-"));
  const tempFile = path.join(tempDir, "hosts");
  try {
    fs.writeFileSync(tempFile, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    const cp = findSystemBinary("cp", ["/bin/cp", "/usr/bin/cp"]);
    if (!cp) throw new Error("cp executable not found");
    await execFileWithPassword(cp, [tempFile, HOSTS_FILE], sudoPassword, { timeoutMs: 10_000, maxOutputBytes: 16 * 1024 });
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
}

/**
 * Check if DNS entry exists for a specific host
 */
function checkDNSEntry(host = null) {
  try {
    const hostsContent = fs.readFileSync(HOSTS_FILE, "utf8");
    const lines = hostsContent.split(/\r?\n/);
    if (host) return lines.some((line) => lineContainsHost(line, host));
    // Legacy: check all antigravity hosts (backward compat)
    return TOOL_HOSTS.antigravity.every((h) => lines.some((line) => lineContainsHost(line, h)));
  } catch {
    return false;
  }
}

/**
 * Check DNS status per tool — returns { [tool]: boolean }
 */
function checkAllDNSStatus() {
  try {
    const hostsContent = fs.readFileSync(HOSTS_FILE, "utf8");
    const lines = hostsContent.split(/\r?\n/);
    const result = {};
    for (const [tool, hosts] of Object.entries(TOOL_HOSTS)) {
      result[tool] = hosts.every((h) => lines.some((line) => lineContainsHost(line, h)));
    }
    return result;
  } catch {
    return Object.fromEntries(Object.keys(TOOL_HOSTS).map(t => [t, false]));
  }
}

/**
 * Add DNS entries for a specific tool
 */
async function addDNSEntry(tool, sudoPassword) {
  const hosts = TOOL_HOSTS[tool];
  if (!hosts) throw new Error(`Unknown tool: ${tool}`);

  const entriesToAdd = hosts.filter(h => !checkDNSEntry(h));
  if (entriesToAdd.length === 0) {
    log(`🌐 DNS ${tool}: already active`);
    return;
  }

  try {
    if (IS_WIN) {
      // Read → trim → append → atomic write (Node-side, no CLI size limit)
      const current = fs.readFileSync(HOSTS_FILE, "utf8");
      const trimmed = current.replace(/[\r\n\s]+$/g, "");
      const toAppend = entriesToAdd.map(h => `127.0.0.1 ${h}`).join("\r\n");
      const next = `${trimmed}\r\n${toAppend}\r\n`;
      atomicWriteHostsWin(HOSTS_FILE, current, next);
      await runElevatedPowerShell("ipconfig /flushdns | Out-Null");
    } else {
      const current = fs.readFileSync(HOSTS_FILE, "utf8");
      const trimmed = current.replace(/[\r\n\s]+$/g, "");
      const toAppend = entriesToAdd.map(h => `127.0.0.1 ${h}`).join("\n");
      const next = `${trimmed}\n${toAppend}\n`;
      await replaceHostsUnix(next, sudoPassword);
      await flushDNS(sudoPassword);
    }
    log(`🌐 DNS ${tool}: ✅ added ${entriesToAdd.join(", ")}`);
  } catch (error) {
    const detail = safeErrorMessage(error, "DNS update failed");
    const msg = /incorrect password|sorry, try again/i.test(detail) ? "Wrong sudo password" : `Failed to add DNS entry: ${detail}`;
    throw new Error(msg);
  }
}

/**
 * Remove DNS entries for a specific tool
 */
async function removeDNSEntry(tool, sudoPassword) {
  const hosts = TOOL_HOSTS[tool];
  if (!hosts) throw new Error(`Unknown tool: ${tool}`);

  const entriesToRemove = hosts.filter(h => checkDNSEntry(h));
  if (entriesToRemove.length === 0) {
    log(`🌐 DNS ${tool}: already inactive`);
    return;
  }

  try {
    if (IS_WIN) {
      const current = fs.readFileSync(HOSTS_FILE, "utf8");
      const filtered = current.split(/\r?\n/).filter((line) => !entriesToRemove.some((h) => lineContainsHost(line, h))).join("\r\n");
      const next = filtered.replace(/[\r\n\s]+$/g, "") + "\r\n";
      atomicWriteHostsWin(HOSTS_FILE, current, next);
      await runElevatedPowerShell("ipconfig /flushdns | Out-Null");
    } else {
      const current = fs.readFileSync(HOSTS_FILE, "utf8");
      const filtered = current.split(/\r?\n/).filter((line) => !entriesToRemove.some((h) => lineContainsHost(line, h))).join("\n");
      const next = filtered.replace(/[\r\n\s]+$/g, "") + "\n";
      await replaceHostsUnix(next, sudoPassword);
      await flushDNS(sudoPassword);
    }
    log(`🌐 DNS ${tool}: ✅ removed ${entriesToRemove.join(", ")}`);
  } catch (error) {
    const detail = safeErrorMessage(error, "DNS update failed");
    const msg = /incorrect password|sorry, try again/i.test(detail) ? "Wrong sudo password" : `Failed to remove DNS entry: ${detail}`;
    throw new Error(msg);
  }
}

/**
 * Remove ALL tool DNS entries (used when stopping server)
 */
async function removeAllDNSEntries(sudoPassword) {
  for (const tool of Object.keys(TOOL_HOSTS)) {
    try {
      await removeDNSEntry(tool, sudoPassword);
    } catch (e) {
      err(`DNS ${tool}: failed to remove — ${e.message}`);
    }
  }
}

/**
 * Sync removal of ALL tool DNS entries — for use during process shutdown
 * when async ops aren't safe. Assumes caller already has root/admin rights.
 */
function removeAllDNSEntriesSync() {
  try {
    if (!fs.existsSync(HOSTS_FILE)) return;
    const allHosts = Object.values(TOOL_HOSTS).flat();
    const content = fs.readFileSync(HOSTS_FILE, "utf8");
    const eol = IS_WIN ? "\r\n" : "\n";
    const filtered = content.split(/\r?\n/).filter((line) => !allHosts.some((h) => lineContainsHost(line, h))).join(eol);
    const next = filtered.replace(/[\r\n\s]+$/g, "") + eol;
    if (next === content) return;
    fs.writeFileSync(HOSTS_FILE, next, "utf8");
    if (IS_WIN) {
      try { runFileSync("ipconfig.exe", ["/flushdns"], { stdio: "ignore", timeoutMs: 5000 }); } catch {}
    } else if (IS_MAC) {
      try { runFileSync("/usr/bin/dscacheutil", ["-flushcache"], { stdio: "ignore", timeoutMs: 5000 }); } catch {}
      try { runFileSync("/usr/bin/killall", ["-HUP", "mDNSResponder"], { stdio: "ignore", timeoutMs: 5000 }); } catch {}
    } else {
      const resolvectl = findSystemBinary("resolvectl", ["/usr/bin/resolvectl", "/bin/resolvectl"]);
      if (resolvectl) try { runFileSync(resolvectl, ["flush-caches"], { stdio: "ignore", timeoutMs: 5000 }); } catch {}
    }
  } catch { /* best effort during shutdown */ }
}

module.exports = {
  TOOL_HOSTS,
  addDNSEntry,
  removeDNSEntry,
  removeAllDNSEntries,
  removeAllDNSEntriesSync,
  execFileWithPassword,
  isSudoAvailable,
  canRunSudoWithoutPassword,
  isSudoPasswordRequired,
  checkDNSEntry,
  checkAllDNSStatus,
  __test__: { lineContainsHost, normalizeHostsContent },
};
