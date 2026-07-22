import fs from "fs";
import path from "path";
import { TUNNEL_DIR, ensureTunnelDir } from "../shared/state.js";
import { parsePid, readPidRecord, writePidRecord } from "@/lib/security/privilegedProcess.js";

const PID_FILE = path.join(TUNNEL_DIR, "cloudflared.pid");

export function savePid(pid, executable = null) {
  ensureTunnelDir();
  writePidRecord(PID_FILE, { pid, executable, startedAt: Date.now() });
}

export function loadPidRecord() {
  return readPidRecord(PID_FILE);
}

export function loadPid() {
  return loadPidRecord()?.pid || null;
}

export function clearPid(expectedPid = null) {
  try {
    if (!fs.existsSync(PID_FILE)) return;
    if (expectedPid != null) {
      const current = loadPid();
      if (current && current !== parsePid(expectedPid)) return;
    }
    fs.unlinkSync(PID_FILE);
  } catch {}
}

export { PID_FILE };
