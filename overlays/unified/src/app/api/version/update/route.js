import { NextResponse } from "next/server";
import { killAppProcesses, spawnGitUpdaterAndExit } from "@/lib/appUpdater";
import { assertGitUpdateReady } from "@/lib/gitUpdate";

export async function POST() {
  if (process.env.NODE_ENV !== "production") {
    return NextResponse.json(
      { success: false, message: "Update is only available in production build (proxy-max CLI)" },
      { status: 403 }
    );
  }

  try {
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
