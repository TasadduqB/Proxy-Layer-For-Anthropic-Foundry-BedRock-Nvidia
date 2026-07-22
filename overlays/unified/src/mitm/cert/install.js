"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFileWithPassword, isSudoAvailable } = require("../dns/dnsConfig.js");
const { runElevatedPowerShell, quotePs } = require("../winElevated.js");
const { findSystemBinary, runFile, safeErrorMessage } = require("../process.js");
const { log } = require("../logger");

const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const ROOT_CA_CN = "Proxy Max MITM Root CA";
const LINUX_CERT_PATHS = [
  { dir: "/usr/local/share/ca-certificates", cmd: "update-ca-certificates", candidates: ["/usr/sbin/update-ca-certificates", "/usr/bin/update-ca-certificates"] },
  { dir: "/etc/ca-certificates/trust-source/anchors", cmd: "update-ca-trust", candidates: ["/usr/bin/update-ca-trust", "/usr/sbin/update-ca-trust"] },
  { dir: "/etc/pki/ca-trust/source/anchors", cmd: "update-ca-trust", candidates: ["/usr/bin/update-ca-trust", "/usr/sbin/update-ca-trust"] },
  { dir: "/etc/pki/trust/anchors", cmd: "update-ca-certificates", candidates: ["/usr/sbin/update-ca-certificates", "/usr/bin/update-ca-certificates"] },
];

function getLinuxCertConfig() {
  return LINUX_CERT_PATHS.find((config) => fs.existsSync(config.dir)) || LINUX_CERT_PATHS[0];
}

function assertCertificateFile(certPath) {
  const stat = fs.statSync(certPath);
  if (!stat.isFile() || stat.size < 256 || stat.size > 1024 * 1024) throw new Error("Invalid certificate file");
  const pem = fs.readFileSync(certPath, "utf8");
  if (!/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----\s*$/.test(pem)) throw new Error("Invalid certificate PEM");
  return pem;
}

function getCertFingerprint(certPath) {
  const pem = assertCertificateFile(certPath);
  const der = Buffer.from(pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, ""), "base64");
  return crypto.createHash("sha1").update(der).digest("hex").toUpperCase().match(/.{2}/g).join(":");
}

async function checkCertInstalled(certPath) {
  if (IS_WIN) return checkCertInstalledWindows(certPath);
  if (IS_MAC) return checkCertInstalledMac(certPath);
  return checkCertInstalledLinux();
}

async function checkCertInstalledMac(certPath) {
  try {
    const fingerprint = getCertFingerprint(certPath).replace(/:/g, "");
    const security = findSystemBinary("security", ["/usr/bin/security"]);
    if (!security) return false;
    const found = await runFile(security, ["find-certificate", "-a", "-c", ROOT_CA_CN, "-Z", "/Library/Keychains/System.keychain"], { timeoutMs: 5000 });
    if (!new RegExp(`SHA-1 hash:\\s*${fingerprint}`, "i").test(found.stdout)) return false;
    await runFile(security, ["verify-cert", "-c", certPath, "-p", "ssl", "-k", "/Library/Keychains/System.keychain"], { timeoutMs: 5000 });
    return true;
  } catch { return false; }
}

async function checkCertInstalledWindows(certPath) {
  try {
    const fingerprint = getCertFingerprint(certPath).replace(/:/g, "");
    await runFile("certutil.exe", ["-store", "Root", fingerprint], { timeoutMs: 5000, maxOutputBytes: 256 * 1024 });
    return true;
  } catch { return false; }
}

async function installCert(sudoPassword, certPath) {
  if (!fs.existsSync(certPath)) throw new Error("Certificate file not found");
  assertCertificateFile(certPath);
  if (await checkCertInstalled(certPath)) {
    log("🔐 Cert: already trusted ✅");
    return;
  }
  if (IS_WIN) await installCertWindows(certPath);
  else if (IS_MAC) await installCertMac(sudoPassword, certPath);
  else await installCertLinux(sudoPassword, certPath);
}

async function installCertMac(sudoPassword, certPath) {
  const security = findSystemBinary("security", ["/usr/bin/security"]);
  if (!security) throw new Error("macOS security utility was not found");
  try {
    try {
      await execFileWithPassword(security, ["delete-certificate", "-c", ROOT_CA_CN, "/Library/Keychains/System.keychain"], sudoPassword, { timeoutMs: 10_000 });
    } catch {}
    await execFileWithPassword(security, ["add-trusted-cert", "-d", "-r", "trustRoot", "-k", "/Library/Keychains/System.keychain", certPath], sudoPassword, { timeoutMs: 30_000 });
    log("🔐 Cert: ✅ installed to system keychain");
  } catch (error) {
    const detail = safeErrorMessage(error, "Certificate install failed");
    throw new Error(/canceled/i.test(detail) ? "User canceled authorization" : "Certificate install failed");
  }
}

async function installCertWindows(certPath) {
  const script = `
    certutil -delstore Root ${quotePs(ROOT_CA_CN)} 2>$null | Out-Null
    & certutil -addstore Root ${quotePs(certPath)} 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "certutil failed" }
  `;
  try {
    await runElevatedPowerShell(script);
    log("🔐 Cert: ✅ installed to Windows Root store");
  } catch (error) {
    throw new Error(`Failed to install certificate: ${safeErrorMessage(error)}`);
  }
}

async function uninstallCert(sudoPassword, certPath) {
  if (!(await checkCertInstalled(certPath))) {
    log("🔐 Cert: not found in system store");
    return;
  }
  if (IS_WIN) await uninstallCertWindows();
  else if (IS_MAC) await uninstallCertMac(sudoPassword, certPath);
  else await uninstallCertLinux(sudoPassword);
}

async function uninstallCertMac(sudoPassword, certPath) {
  const security = findSystemBinary("security", ["/usr/bin/security"]);
  const fingerprint = getCertFingerprint(certPath).replace(/:/g, "");
  try {
    await execFileWithPassword(security, ["delete-certificate", "-Z", fingerprint, "/Library/Keychains/System.keychain"], sudoPassword, { timeoutMs: 15_000 });
    log("🔐 Cert: ✅ uninstalled from system keychain");
  } catch { throw new Error("Failed to uninstall certificate"); }
}

async function uninstallCertWindows() {
  try {
    await runElevatedPowerShell(`certutil -delstore Root ${quotePs(ROOT_CA_CN)} | Out-Null`);
    log("🔐 Cert: ✅ uninstalled from Windows Root store");
  } catch (error) {
    throw new Error(`Failed to uninstall certificate: ${safeErrorMessage(error)}`);
  }
}

function checkCertInstalledLinux() {
  return Promise.resolve(fs.existsSync(path.join(getLinuxCertConfig().dir, "proxy-max-root-ca.crt")));
}

function safeProfileDirs() {
  const home = fs.realpathSync(os.homedir());
  const dirs = [path.join(home, ".pki", "nssdb"), path.join(home, "snap", "chromium", "current", ".pki", "nssdb")];
  for (const base of [path.join(home, ".mozilla", "firefox"), path.join(home, "snap", "firefox", "common", ".mozilla", "firefox")]) {
    try {
      for (const name of fs.readdirSync(base)) dirs.push(path.join(base, name));
    } catch {}
  }
  return dirs.filter((candidate) => {
    try {
      const real = fs.realpathSync(candidate);
      return (real === home || real.startsWith(`${home}${path.sep}`)) && fs.statSync(real).isDirectory();
    } catch { return false; }
  });
}

async function updateNssDatabases(certPath, action = "add") {
  const certutil = findSystemBinary("certutil", ["/usr/bin/certutil", "/usr/local/bin/certutil"]);
  if (!certutil) return;
  for (const db of safeProfileDirs()) {
    const hasDb = fs.existsSync(path.join(db, "cert9.db")) || fs.existsSync(path.join(db, "cert8.db")) || db.endsWith(`${path.sep}nssdb`);
    if (!hasDb) continue;
    const variants = [`sql:${db}`, db];
    for (const database of variants) {
      try {
        const args = action === "add"
          ? ["-d", database, "-A", "-t", "C,,", "-n", ROOT_CA_CN, "-i", certPath]
          : ["-d", database, "-D", "-n", ROOT_CA_CN];
        await runFile(certutil, args, { timeoutMs: 10_000, maxOutputBytes: 64 * 1024 });
        break;
      } catch {}
    }
  }
}

async function runLinuxTrustUpdate(config, sudoPassword) {
  const command = findSystemBinary(config.cmd, config.candidates);
  if (command) await execFileWithPassword(command, [], sudoPassword, { timeoutMs: 60_000, maxOutputBytes: 256 * 1024 });
}

async function installCertLinux(sudoPassword, certPath) {
  if (!isSudoAvailable()) {
    log(`🔐 Cert: cannot install to system store without sudo — trust this file on clients: ${certPath}`);
    await updateNssDatabases(certPath, "add");
    return;
  }
  const config = getLinuxCertConfig();
  const destFile = path.join(config.dir, "proxy-max-root-ca.crt");
  const install = findSystemBinary("install", ["/usr/bin/install", "/bin/install"]);
  if (!install) throw new Error("install utility was not found");
  try {
    await execFileWithPassword(install, ["-m", "0644", certPath, destFile], sudoPassword, { timeoutMs: 15_000 });
    await runLinuxTrustUpdate(config, sudoPassword);
    await updateNssDatabases(certPath, "add");
    log(`🔐 Cert: ✅ installed to Linux trust store (${config.dir}) and user browser databases`);
  } catch (error) {
    throw new Error(`Certificate install failed: ${safeErrorMessage(error)}`);
  }
}

async function uninstallCertLinux(sudoPassword) {
  await updateNssDatabases(null, "delete");
  if (!isSudoAvailable()) return;
  const config = getLinuxCertConfig();
  const destFile = path.join(config.dir, "proxy-max-root-ca.crt");
  const rm = findSystemBinary("rm", ["/bin/rm", "/usr/bin/rm"]);
  try {
    await execFileWithPassword(rm, ["-f", destFile], sudoPassword, { timeoutMs: 10_000 });
    await runLinuxTrustUpdate(config, sudoPassword);
    log("🔐 Cert: ✅ uninstalled from Linux trust store and user browser databases");
  } catch { throw new Error("Failed to uninstall certificate"); }
}

module.exports = {
  installCert,
  uninstallCert,
  checkCertInstalled,
  __test__: { assertCertificateFile, getCertFingerprint, safeProfileDirs },
};
