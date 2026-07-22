import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { DATA_DIR } from "@/lib/dataDir.js";
import { findExecutable } from "@/lib/security/privilegedProcess.js";

export const PXPIPE_DIR = path.join(DATA_DIR, "pxpipe");
export const PXPIPE_PACKAGE = "pxpipe-proxy";
const INSTALL_LOG = path.join(PXPIPE_DIR, "install.log");
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;
const INSTALL_LOG_MAX_BYTES = 5 * 1024 * 1024;
const INSTALL_LOG_TAIL_BYTES = 256 * 1024;

const IS_WIN = process.platform === "win32";
const NPM_CMD = IS_WIN ? "npm.cmd" : "npm";

// Same PATH extension trick as headroom/detect.js: packaged/launchd environments
// often miss the Node bin dirs.
const EXTRA_BINS = IS_WIN
  ? [`${process.env.ProgramFiles || ""}\\nodejs`, `${process.env.APPDATA || ""}\\npm`]
  : ["/usr/local/bin", "/opt/homebrew/bin", `${process.env.HOME || ""}/.local/bin`, "/usr/bin", "/bin"];
const EXTENDED_PATH = [...EXTRA_BINS, process.env.PATH || ""].filter(Boolean).join(path.delimiter);

let installInFlight = null;

function ensureDir() {
  if (!fs.existsSync(PXPIPE_DIR)) fs.mkdirSync(PXPIPE_DIR, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(PXPIPE_DIR, 0o700); } catch {}
}

export function packageRoot() {
  return path.join(PXPIPE_DIR, "node_modules", PXPIPE_PACKAGE);
}

export function libraryEntry() {
  return path.join(packageRoot(), "dist", "core", "library.js");
}

export function findNpm() {
  const names = IS_WIN ? ["npm.cmd", "npm.exe"] : ["npm"];
  const candidates = [];
  for (const dir of EXTENDED_PATH.split(path.delimiter).filter(Boolean)) {
    for (const name of names) candidates.push(path.join(dir, name));
  }
  return findExecutable("", candidates);
}

function npmInvocation(npmPath) {
  if (!IS_WIN) return { file: npmPath, prefixArgs: [] };
  const cliCandidates = [
    path.join(path.dirname(npmPath), "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    path.resolve(path.dirname(npmPath), "..", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  const cli = cliCandidates.find((candidate) => {
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  });
  if (!cli) return null;
  return { file: process.execPath, prefixArgs: [cli] };
}

// { installed, version, path } — installed means the library entry exists on disk.
export function getInstallInfo() {
  try {
    const pkgJson = path.join(packageRoot(), "package.json");
    if (!fs.existsSync(pkgJson) || !fs.existsSync(libraryEntry())) {
      return { installed: false, version: null, path: null };
    }
    const pkg = JSON.parse(fs.readFileSync(pkgJson, "utf8"));
    return { installed: true, version: pkg.version || null, path: packageRoot() };
  } catch {
    return { installed: false, version: null, path: null };
  }
}

export function isInstalling() {
  return installInFlight !== null;
}

// Install (or repair by reinstalling) pxpipe-proxy into DATA_DIR/pxpipe.
// Serialized: concurrent calls await the same run.
export function installPxpipe() {
  if (installInFlight) return installInFlight;
  installInFlight = runInstall().finally(() => { installInFlight = null; });
  return installInFlight;
}

async function runInstall() {
  const npm = findNpm();
  if (!npm) {
    const err = new Error("npm not found on PATH — Node.js/npm is required to install PXPIPE");
    err.code = "NPM_NOT_FOUND";
    throw err;
  }
  const invocation = npmInvocation(npm);
  if (!invocation) {
    const err = new Error("npm CLI runtime was not found");
    err.code = "NPM_RUNTIME_NOT_FOUND";
    throw err;
  }

  ensureDir();
  const pkgJson = path.join(PXPIPE_DIR, "package.json");
  if (!fs.existsSync(pkgJson)) {
    fs.writeFileSync(pkgJson, JSON.stringify({ name: "proxy-max-pxpipe-host", private: true }, null, 2), { mode: 0o600, flag: "wx" });
  }

  rotateInstallLog();
  const outFd = fs.openSync(INSTALL_LOG, "a", 0o600);
  fs.writeSync(outFd, `\n[${new Date().toISOString()}] npm install ${PXPIPE_PACKAGE}@latest\n`);

  await new Promise((resolve, reject) => {
    const child = spawn(invocation.file, [...invocation.prefixArgs, "install", `${PXPIPE_PACKAGE}@latest`, "--no-audit", "--no-fund", "--omit=dev", "--ignore-scripts"], {
      cwd: PXPIPE_DIR,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
      detached: !IS_WIN,
      env: { ...process.env, PATH: EXTENDED_PATH },
    });
    let settled = false;
    let bytesWritten = fs.fstatSync(outFd).size;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const append = (chunk) => {
      if (settled) return;
      const text = redactInstallOutput(chunk.toString("utf8"));
      const buf = Buffer.from(text);
      bytesWritten += buf.length;
      if (bytesWritten > INSTALL_LOG_MAX_BYTES) {
        killInstallTree(child);
        const error = new Error("npm install output exceeded the 5 MiB safety limit — see install.log");
        error.code = "INSTALL_OUTPUT_LIMIT";
        finish(error);
        return;
      }
      try { fs.writeSync(outFd, buf); } catch {}
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    const timer = setTimeout(() => {
      killInstallTree(child);
      const error = new Error("npm install timed out after 5 minutes — see install.log");
      error.code = "INSTALL_TIMEOUT";
      finish(error);
    }, INSTALL_TIMEOUT_MS);
    timer.unref?.();
    child.once("error", finish);
    child.once("exit", (code) => {
      if (code === 0) finish();
      else {
        const error = new Error(`npm install exited with code ${code} — see install.log`);
        error.code = "INSTALL_FAILED";
        finish(error);
      }
    });
  }).finally(() => fs.closeSync(outFd));

  const info = getInstallInfo();
  if (!info.installed) throw new Error("install finished but package is missing — see install.log");
  return info;
}

export function getInstallLogTail(maxLines = 200) {
  try {
    if (!fs.existsSync(INSTALL_LOG)) return "";
    const safeLines = Math.min(500, Math.max(1, Number(maxLines) || 200));
    const stat = fs.statSync(INSTALL_LOG);
    const length = Math.min(stat.size, INSTALL_LOG_TAIL_BYTES);
    const fd = fs.openSync(INSTALL_LOG, "r");
    const buf = Buffer.alloc(length);
    try { fs.readSync(fd, buf, 0, length, stat.size - length); } finally { fs.closeSync(fd); }
    const lines = buf.toString("utf8").split(/\r?\n/).filter(Boolean);
    return lines.slice(-safeLines).join("\n");
  } catch {
    return "";
  }
}

function redactInstallOutput(text) {
  return String(text)
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[credentials]@")
    .replace(/(token|password|secret|authorization)\s*[=:]\s*[^\s]+/gi, "$1=[redacted]");
}

function rotateInstallLog() {
  try {
    if (!fs.existsSync(INSTALL_LOG) || fs.statSync(INSTALL_LOG).size < INSTALL_LOG_MAX_BYTES) return;
    const rotated = `${INSTALL_LOG}.1`;
    try { fs.unlinkSync(rotated); } catch {}
    fs.renameSync(INSTALL_LOG, rotated);
  } catch {}
}

function killInstallTree(child) {
  if (!child?.pid) return;
  try {
    if (IS_WIN) child.kill("SIGKILL");
    else process.kill(-child.pid, "SIGKILL");
  } catch {
    try { child.kill("SIGKILL"); } catch {}
  }
}

export const __test__ = {
  redactInstallOutput,
  rotateInstallLog,
  INSTALL_LOG_MAX_BYTES,
  INSTALL_LOG_TAIL_BYTES,
  npmInvocation,
};
