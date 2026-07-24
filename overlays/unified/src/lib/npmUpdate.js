import { UPDATER_CONFIG } from "@/shared/constants/config";

const REGISTRY_ORIGIN = "https://registry.npmjs.org";

function parseVersion(value) {
  const match = String(value || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return {
    numbers: match.slice(1, 4).map(Number),
    prerelease: match[4] || null,
  };
}

export function compareVersions(leftValue, rightValue) {
  const left = parseVersion(leftValue);
  const right = parseVersion(rightValue);
  if (!left || !right) throw new Error("The npm registry returned an invalid package version");
  for (let index = 0; index < 3; index += 1) {
    const difference = left.numbers[index] - right.numbers[index];
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  if (left.prerelease === right.prerelease) return 0;
  if (!left.prerelease) return 1;
  if (!right.prerelease) return -1;
  return left.prerelease.localeCompare(right.prerelease, "en", { numeric: true });
}

export async function getNpmUpdateStatus(currentVersion, options = {}) {
  if (!parseVersion(currentVersion)) throw new Error("The installed Proxy Max version is invalid");
  const fetchImpl = options.fetchImpl || fetch;
  const packageName = UPDATER_CONFIG.npmPackageName;
  const response = await fetchImpl(`${REGISTRY_ORIGIN}/${encodeURIComponent(packageName)}/latest`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(options.timeoutMs || 10000),
  });
  if (!response.ok) throw new Error(`npm registry check failed with HTTP ${response.status}`);
  const metadata = await response.json();
  if (metadata?.name !== packageName || !parseVersion(metadata?.version)) {
    throw new Error("npm registry metadata did not match Proxy Max");
  }
  const latestVersion = metadata.version;
  const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;
  return {
    source: "npm",
    packageName,
    currentVersion,
    latestVersion,
    hasUpdate,
    canUpdate: hasUpdate,
    blockedReason: null,
    updatePolicy: "trusted-npm-package",
  };
}

export async function assertNpmUpdateReady(currentVersion, options = {}) {
  const status = await getNpmUpdateStatus(currentVersion, options);
  if (!status.hasUpdate) {
    const error = new Error("Proxy Max is already up to date");
    error.statusCode = 409;
    throw error;
  }
  return status;
}

export const __test__ = { REGISTRY_ORIGIN, parseVersion };
