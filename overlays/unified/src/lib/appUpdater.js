import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";
import { UPDATER_CONFIG } from "@/shared/constants/config";
import {
  findExecutable,
  terminateTrackedProcess,
} from "@/lib/security/privilegedProcess.js";

const TRUSTED_PACKAGE = UPDATER_CONFIG.npmPackageName;

function getDataDir() {
  if (process.env.DATA_DIR) return path.resolve(process.env.DATA_DIR);
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "proxy-max");
  }
  return path.join(os.homedir(), ".proxy-max");
}

function resolveBundledUpdaterPath(fileName = "updater.js") {
  const candidates = [
    fileName === "updater.js" ? process.env.UPDATER_SCRIPT_PATH : process.env.GIT_UPDATER_SCRIPT_PATH,
    path.join(process.cwd(), "src", "lib", "updater", fileName),
    path.join(process.cwd(), "..", "src", "lib", "updater", fileName),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const real = fs.realpathSync(candidate);
      if (fs.statSync(real).isFile()) return real;
    } catch {}
  }
  return null;
}

function ensureRuntimeUpdater(bundledPath, fileName = "updater.js") {
  if (!bundledPath) throw new Error("Bundled updater was not found");
  const runtimeDir = path.join(getDataDir(), "runtime", "updater");
  const runtimePath = path.join(runtimeDir, fileName);
  fs.mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  const source = fs.readFileSync(bundledPath);
  const digest = crypto.createHash("sha256").update(source).digest("hex");
  let currentDigest = null;
  try {
    currentDigest = crypto.createHash("sha256").update(fs.readFileSync(runtimePath)).digest("hex");
  } catch {}
  if (currentDigest !== digest) {
    const temp = `${runtimePath}.${process.pid}.tmp`;
    fs.writeFileSync(temp, source, { mode: 0o600, flag: "wx" });
    fs.renameSync(temp, runtimePath);
  }
  try { fs.chmodSync(runtimePath, 0o600); } catch {}
  return runtimePath;
}

// Stop only processes recorded by this installation. The former fuzzy `ps`
// scan could terminate unrelated Node/cloudflared processes whose command line
// happened to contain a common substring.
export async function killAppProcesses() {
  const dataDir = getDataDir();
  const targets = [
    {
      file: path.join(dataDir, "mitm", ".mitm.pid"),
      tokens: ["server.js"],
    },
    {
      file: path.join(dataDir, "tunnel", "cloudflared.pid"),
      tokens: ["cloudflared"],
    },
  ];
  return Promise.all(targets.map(({ file, tokens }) => terminateTrackedProcess(file, tokens, { graceMs: 1000 })));
}

function resolveRelaunchCommand() {
  const names = process.platform === "win32" ? ["npx.cmd", "npx.exe"] : ["npx"];
  const candidates = [];
  for (const dir of (process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
    for (const name of names) candidates.push(path.join(dir, name));
  }
  const cmd = findExecutable("", candidates);
  if (!cmd) return null;
  if (process.platform === "win32") {
    const cliCandidates = [
      path.join(path.dirname(cmd), "node_modules", "npm", "bin", "npx-cli.js"),
      path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js"),
      path.resolve(path.dirname(cmd), "..", "node_modules", "npm", "bin", "npx-cli.js"),
    ];
    const npxCli = cliCandidates.find((candidate) => {
      try { return fs.statSync(candidate).isFile(); } catch { return false; }
    });
    return npxCli ? { cmd: process.execPath, args: [npxCli, "--no-install", TRUSTED_PACKAGE] } : null;
  }
  return { cmd, args: ["--no-install", TRUSTED_PACKAGE] };
}

export function spawnUpdaterAndExit(packageName = TRUSTED_PACKAGE) {
  if (packageName !== TRUSTED_PACKAGE) throw new Error("Refusing to update an unexpected package");
  const updaterPath = ensureRuntimeUpdater(resolveBundledUpdaterPath());
  const isTray = process.env.TRAY_MODE === "1";
  const relaunch = resolveRelaunchCommand();
  const relaunchArgs = relaunch
    ? (isTray ? [...relaunch.args, "--tray", "--skip-update"] : [...relaunch.args, "--skip-update"])
    : [];

  const child = spawn(process.execPath, [updaterPath], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    shell: false,
    env: {
      ...process.env,
      UPDATER_PKG_NAME: TRUSTED_PACKAGE,
      UPDATER_PORT: String(UPDATER_CONFIG.statusPort),
      UPDATER_TAIL_LINES: String(UPDATER_CONFIG.statusLogTailLines),
      UPDATER_RETRIES: String(UPDATER_CONFIG.installRetries),
      UPDATER_RETRY_DELAY_MS: String(UPDATER_CONFIG.installRetryDelayMs),
      UPDATER_LINGER_MS: String(UPDATER_CONFIG.lingerAfterDoneMs),
      UPDATER_WAIT_MIN_MS: String(UPDATER_CONFIG.waitForExitMinMs),
      UPDATER_WAIT_MAX_MS: String(UPDATER_CONFIG.waitForExitMaxMs),
      UPDATER_WAIT_CHECK_MS: String(UPDATER_CONFIG.waitForExitCheckMs),
      UPDATER_APP_PORT: String(UPDATER_CONFIG.appPort),
      UPDATER_RELAUNCH: relaunch ? "1" : "0",
      UPDATER_RELAUNCH_CMD: relaunch?.cmd || "",
      UPDATER_RELAUNCH_ARGS: JSON.stringify(relaunchArgs),
    },
  });
  child.unref();
  setTimeout(() => process.exit(0), UPDATER_CONFIG.exitDelayMs).unref?.();
  return { pid: child.pid };
}

export function spawnGitUpdaterAndExit(update) {
  if (!update || update.source !== "git" || update.canUpdate !== true) {
    throw new Error("A verified Git update is required");
  }
  const sourceRoot = process.env.PROXY_MAX_SOURCE_ROOT;
  if (!sourceRoot || !path.isAbsolute(sourceRoot)) throw new Error("Source checkout is unavailable");
  const updaterPath = ensureRuntimeUpdater(resolveBundledUpdaterPath("git-updater.js"), "git-updater.js");
  const appPort = Number.parseInt(process.env.PORT || "", 10) || UPDATER_CONFIG.appPort;
  const child = spawn(process.execPath, [updaterPath], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    shell: false,
    env: {
      ...process.env,
      GIT_UPDATER_SOURCE_ROOT: fs.realpathSync(sourceRoot),
      GIT_UPDATER_REPOSITORY: update.repository,
      GIT_UPDATER_REMOTE: "origin",
      GIT_UPDATER_BRANCH: update.branch,
      GIT_UPDATER_EXPECTED_REVISION: update.latestRevision,
      UPDATER_PORT: String(UPDATER_CONFIG.statusPort),
      UPDATER_APP_PORT: String(appPort),
      UPDATER_LINGER_MS: String(UPDATER_CONFIG.lingerAfterDoneMs),
      UPDATER_TAIL_LINES: String(UPDATER_CONFIG.statusLogTailLines),
    },
  });
  child.unref();
  setTimeout(() => process.exit(0), UPDATER_CONFIG.exitDelayMs).unref?.();
  return { pid: child.pid, statusPort: UPDATER_CONFIG.statusPort };
}

export const __test__ = {
  getDataDir,
  resolveBundledUpdaterPath,
  ensureRuntimeUpdater,
  resolveRelaunchCommand,
  TRUSTED_PACKAGE,
};
