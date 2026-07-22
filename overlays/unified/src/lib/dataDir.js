import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { threadId as currentThreadId } from "node:worker_threads";

const APP_NAME = "proxy-max";
const BUILD_DATA_ROOT_ENV = "PROXY_MAX_UNIFIED_BUILD_DATA_ROOT";

function defaultDir({ env = process.env, platform = process.platform, homeDir = os.homedir() } = {}) {
  if (platform === "win32") {
    return path.join(env.APPDATA || path.join(homeDir, "AppData", "Roaming"), APP_NAME);
  }
  return path.join(homeDir, `.${APP_NAME}`);
}

function safeWorkerNumber(value, fallback, { allowZero = false } = {}) {
  const numeric = Number(value);
  if (Number.isSafeInteger(numeric) && (allowZero ? numeric >= 0 : numeric > 0)) return numeric;
  return fallback;
}

export function resolveDataDir(env = process.env, {
  pid = process.pid,
  threadId = currentThreadId,
  platform = process.platform,
  homeDir = os.homedir(),
} = {}) {
  const buildRoot = String(env[BUILD_DATA_ROOT_ENV] || "").trim();
  if (buildRoot) {
    const workerPid = safeWorkerNumber(pid, process.pid);
    const workerThread = safeWorkerNumber(threadId, currentThreadId, { allowZero: true });
    return path.join(path.resolve(buildRoot), `worker-${workerPid}-${workerThread}`);
  }

  const configured = env.DATA_DIR;
  if (!configured) return defaultDir({ env, platform, homeDir });
  if (platform === "win32" && /^\//.test(configured)) {
    return defaultDir({ env, platform, homeDir });
  }
  return configured;
}

function ensurePrivateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(directory, 0o700); } catch { /* POSIX modes are best-effort on Windows. */ }
  return directory;
}

export function getDataDir() {
  const buildRoot = String(process.env[BUILD_DATA_ROOT_ENV] || "").trim();
  if (buildRoot) return ensurePrivateDirectory(resolveDataDir());

  const configured = process.env.DATA_DIR;
  if (!configured) return defaultDir();

  // On Windows, ignore Unix-style absolute paths (e.g. /var/lib/...) that come
  // from a Linux-targeted .env or Docker config — they are not valid here.
  if (process.platform === "win32" && /^\//.test(configured)) {
    console.warn(`[DATA_DIR] '${configured}' is a Unix path on Windows → fallback to default`);
    return defaultDir();
  }

  try {
    return ensurePrivateDirectory(configured);
  } catch (e) {
    if (e?.code === "EACCES" || e?.code === "EPERM") {
      console.warn(`[DATA_DIR] '${configured}' not writable → fallback ~/.${APP_NAME}`);
      return defaultDir();
    }
    throw e;
  }
}

export const DATA_DIR = getDataDir();
