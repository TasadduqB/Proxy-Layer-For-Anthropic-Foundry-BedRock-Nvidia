"use server";

import os from "os";
import fs from "fs";
import { installTailscale, loadState, generateShortId } from "@/lib/tunnel";
import { getCachedPassword, loadEncryptedPassword, initDbHooks } from "@/mitm/manager";
import { getSettings, updateSettings } from "@/lib/localDb";

initDbHooks(getSettings, updateSettings);

function hasBrew() {
  return ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"].some((candidate) => {
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const platform = os.platform();
  const isWindows = platform === "win32";
  const isBrew = platform === "darwin" && hasBrew();
  const needsPassword = !isWindows && !isBrew;

  const sudoPassword = body.sudoPassword || getCachedPassword() || await loadEncryptedPassword() || "";

  if (typeof sudoPassword !== "string" || /[\0\r\n]/.test(sudoPassword) || Buffer.byteLength(sudoPassword) > 4096) {
    return new Response(JSON.stringify({ error: "Invalid sudo password" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (needsPassword && !sudoPassword.trim()) {
    return new Response(JSON.stringify({ error: "Sudo password is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const shortId = loadState()?.shortId || generateShortId();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event, data) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      try {
        const result = await installTailscale(sudoPassword, shortId, (msg) => {
          send("progress", { message: msg });
        });
        send("done", { success: true, authUrl: result?.authUrl || null });
      } catch (error) {
        console.error("Tailscale install error:", error);
        const raw = String(error?.message || "Tailscale installation failed").replace(/[\r\n\t]+/g, " ").slice(0, 500);
        const msg = raw.includes("incorrect password") || raw.includes("Sorry")
          ? "Wrong sudo password"
          : raw;
        send("error", { error: msg });
      } finally {
        if (!closed) { try { controller.close(); } catch {} }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
