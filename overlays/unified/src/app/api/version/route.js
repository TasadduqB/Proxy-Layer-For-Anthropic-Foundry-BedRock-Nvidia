import pkg from "../../../../package.json" with { type: "json" };
import { getGitUpdateStatus } from "@/lib/gitUpdate";
import { getNpmUpdateStatus } from "@/lib/npmUpdate";

export async function GET() {
  try {
    const status = process.env.PROXY_MAX_DISTRIBUTION === "npm"
      ? await getNpmUpdateStatus(pkg.version)
      : await getGitUpdateStatus();
    return Response.json({ currentVersion: pkg.version, ...status });
  } catch (error) {
    return Response.json({
      currentVersion: pkg.version,
      source: process.env.PROXY_MAX_DISTRIBUTION === "npm" ? "npm" : "git",
      hasUpdate: false,
      canUpdate: false,
      error: error?.message || "Update check failed",
      updatePolicy: process.env.PROXY_MAX_DISTRIBUTION === "npm"
        ? "trusted-npm-package"
        : "trusted-git-fast-forward",
    }, { status: 503 });
  }
}
