import fs from "node:fs";
import path from "node:path";
import { findExecutable, runFile } from "@/lib/security/privilegedProcess.js";
import { GIT_UPDATE_CONFIG } from "@/shared/constants/config";

const UPDATE_REF = "refs/proxy-max/update-candidate";

function executableCandidates(name) {
  const names = process.platform === "win32" ? [`${name}.exe`, `${name}.cmd`, name] : [name];
  const candidates = [];
  for (const directory of String(process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
    for (const candidate of names) candidates.push(path.join(directory, candidate));
  }
  return candidates;
}

export function normalizeGitRemoteUrl(value) {
  const url = String(value || "").trim().replace(/\/+$/, "").replace(/\.git$/i, "");
  const ssh = url.match(/^git@github\.com:([^/]+)\/(.+)$/i);
  if (ssh) return `https://github.com/${ssh[1]}/${ssh[2]}`.toLowerCase();
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com" || parsed.username || parsed.password) return null;
    return `https://github.com${parsed.pathname}`.toLowerCase();
  } catch {
    return null;
  }
}

function assertSafeBranch(value) {
  const branch = String(value || "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(branch) || branch.includes("..") || branch.endsWith("/") || branch.includes("//")) {
    throw new Error("Configured update branch is invalid");
  }
  return branch;
}

function resolveSourceRoot() {
  const configured = process.env.PROXY_MAX_SOURCE_ROOT;
  if (!configured || !path.isAbsolute(configured)) throw new Error("This installation is not linked to a source checkout");
  const root = fs.realpathSync(configured);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  if (pkg?.name !== "proxy-max" || !fs.existsSync(path.join(root, ".git"))) {
    throw new Error("The configured source checkout is not a Proxy Max Git repository");
  }
  return root;
}

function resolveGit() {
  const git = findExecutable("", executableCandidates("git"));
  if (!git) throw new Error("Git was not found on PATH");
  return git;
}

async function git(root, args, options = {}) {
  const result = await runFile(resolveGit(), args, {
    cwd: root,
    timeoutMs: options.timeoutMs || GIT_UPDATE_CONFIG.checkTimeoutMs,
    maxOutputBytes: GIT_UPDATE_CONFIG.maxOutputBytes,
  });
  return result.stdout.trim();
}

async function verifyRemote(root) {
  const actual = normalizeGitRemoteUrl(await git(root, ["remote", "get-url", GIT_UPDATE_CONFIG.remote]));
  const expected = normalizeGitRemoteUrl(GIT_UPDATE_CONFIG.repositoryUrl);
  if (!actual || actual !== expected) throw new Error("The Git remote does not match the trusted Proxy Max repository");
  return actual;
}

function knownBlockedReason({ dirtyCount, behind, ahead }) {
  if (behind === 0) return null;
  if (dirtyCount > 0) return "Commit or stash local changes before updating.";
  if (ahead > 0) return "The current branch has diverged from the update branch; automatic update requires a fast-forward.";
  return null;
}

export async function getGitUpdateStatus(options = {}) {
  const root = resolveSourceRoot();
  await verifyRemote(root);
  const branch = assertSafeBranch(GIT_UPDATE_CONFIG.branch);
  if (options.fetch !== false) {
    await git(root, [
      "fetch", "--no-tags", GIT_UPDATE_CONFIG.remote,
      `+refs/heads/${branch}:${UPDATE_REF}`,
    ], { timeoutMs: GIT_UPDATE_CONFIG.fetchTimeoutMs });
  }

  const [currentRevision, latestRevision, currentBranch, statusText, behindText, aheadText] = await Promise.all([
    git(root, ["rev-parse", "HEAD"]),
    git(root, ["rev-parse", UPDATE_REF]),
    git(root, ["branch", "--show-current"]),
    git(root, ["status", "--porcelain=v1", "--untracked-files=normal"]),
    git(root, ["rev-list", "--count", `HEAD..${UPDATE_REF}`]),
    git(root, ["rev-list", "--count", `${UPDATE_REF}..HEAD`]),
  ]);

  const dirtyCount = statusText ? statusText.split(/\r?\n/).filter(Boolean).length : 0;
  const behind = Number.parseInt(behindText, 10) || 0;
  const ahead = Number.parseInt(aheadText, 10) || 0;
  const hasUpdate = behind > 0;
  const blockedReason = knownBlockedReason({ dirtyCount, behind, ahead });

  return {
    source: "git",
    repository: GIT_UPDATE_CONFIG.repositoryUrl,
    branch,
    currentBranch: currentBranch || "detached",
    currentRevision,
    latestRevision,
    behind,
    ahead,
    dirty: dirtyCount > 0,
    dirtyCount,
    hasUpdate,
    canUpdate: hasUpdate && !blockedReason,
    blockedReason,
    updatePolicy: "trusted-git-fast-forward",
  };
}

export async function assertGitUpdateReady() {
  const status = await getGitUpdateStatus();
  if (!status.hasUpdate) {
    const error = new Error("Proxy Max is already up to date");
    error.statusCode = 409;
    throw error;
  }
  if (!status.canUpdate) {
    const error = new Error(status.blockedReason || "Automatic update is not available for this checkout");
    error.statusCode = 409;
    throw error;
  }
  return status;
}

export const __test__ = { UPDATE_REF, assertSafeBranch, knownBlockedReason };
