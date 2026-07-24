import { NextResponse } from "next/server";
import pkg from "../../../../../package.json" with { type: "json" };
import { killAppProcesses, spawnGitUpdaterAndExit, spawnUpdaterAndExit } from "@/lib/appUpdater";
import { assertGitUpdateReady } from "@/lib/gitUpdate";
import { assertNpmUpdateReady } from "@/lib/npmUpdate";

export async function POST() {
  if (process.env.NODE_ENV !== "production") {
    return NextResponse.json(
      { success: false, message: "Update is only available in production build (proxy-max CLI)" },
      { status: 403 }
    );
  }

  try {
    if (process.env.PROXY_MAX_DISTRIBUTION === "npm") {
      await assertNpmUpdateReady(pkg.version);
      await killAppProcesses();
      const updater = spawnUpdaterAndExit();
      return NextResponse.json({
        success: true,
        message: "npm updater started. Proxy Max will restart automatically.",
        updaterPort: updater.statusPort,
      });
    }
    const update = await assertGitUpdateReady();
    // Kill sibling processes (cloudflared, MITM, stray next-server) to release file locks on Windows
    await killAppProcesses();
    const updater = spawnGitUpdaterAndExit(update);
    return NextResponse.json({
      success: true,
      message: "Git updater started. Proxy Max will restart automatically.",
      updaterPort: updater.statusPort,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error?.message || "Unable to start update" },
      { status: error?.statusCode || 500 }
    );
  }
}
