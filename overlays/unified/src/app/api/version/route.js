import pkg from "../../../../package.json" with { type: "json" };
import { getGitUpdateStatus } from "@/lib/gitUpdate";

export async function GET() {
  try {
    const status = await getGitUpdateStatus();
    return Response.json({ currentVersion: pkg.version, ...status });
  } catch (error) {
    return Response.json({
      currentVersion: pkg.version,
      source: "git",
      hasUpdate: false,
      canUpdate: false,
      error: error?.message || "Update check failed",
      updatePolicy: "trusted-git-fast-forward",
    }, { status: 503 });
  }
}
