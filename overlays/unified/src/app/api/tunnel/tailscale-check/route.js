import os from "os";
import fs from "fs";
import { NextResponse } from "next/server";
import { isTailscaleInstalled, isTailscaleLoggedIn, isSystemDaemonRunning, isDaemonAlive, getTailscaleBin, TAILSCALE_SOCKET } from "@/lib/tunnel";
import { getCachedPassword, loadEncryptedPassword } from "@/mitm/manager";
import { runFile } from "@/lib/security/privilegedProcess.js";

const EXTENDED_PATH = `/usr/local/bin:/opt/homebrew/bin:/usr/sbin:/usr/bin:/bin:/snap/bin:${process.env.PATH || ""}`;
const PROBE_TIMEOUT_MS = 1500;

async function hasBrew() {
  return ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"].some((candidate) => {
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  });
}

async function isCustomDaemonRunning() {
  const bin = getTailscaleBin();
  if (!bin) return false;
  try {
    await runFile(bin, ["--socket", TAILSCALE_SOCKET, "status", "--json"], {
      env: { ...process.env, PATH: EXTENDED_PATH },
      timeoutMs: PROBE_TIMEOUT_MS,
      maxOutputBytes: 256 * 1024,
    });
    return true;
  } catch {
    return isDaemonAlive();
  }
}

export async function GET() {
  try {
    const installed = isTailscaleInstalled();
    const platform = os.platform();
    // Run independent probes in parallel — none blocks the event loop
    const [brewAvailable, customDaemonRunning, systemDaemonRunning] = await Promise.all([
      platform === "darwin" ? hasBrew() : Promise.resolve(false),
      installed ? isCustomDaemonRunning() : Promise.resolve(false),
      installed ? Promise.resolve(isSystemDaemonRunning()) : Promise.resolve(false),
    ]);
    const daemonRunning = customDaemonRunning || systemDaemonRunning;
    const loggedIn = daemonRunning ? isTailscaleLoggedIn() : false;
    const hasCachedPassword = !!(getCachedPassword() || await loadEncryptedPassword());
    return NextResponse.json({ installed, loggedIn, platform, brewAvailable, daemonRunning, customDaemonRunning, systemDaemonRunning, hasCachedPassword });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
