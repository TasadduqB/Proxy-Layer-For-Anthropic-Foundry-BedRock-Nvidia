import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { setDashboardAuthCookie } from "@/lib/auth/dashboardSession";
import { isOidcConfigured } from "@/lib/auth/oidc";
import { checkLock, recordFail, recordSuccess, getClientIp } from "@/lib/auth/loginLimiter";

const RESET_HINT = "Forgot password? On the Proxy Max host, run: npm run proxy-max:reset-password";
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function isTunnelRequest(request, settings) {
  const host = (request.headers.get("host") || "").split(":")[0].toLowerCase();
  const tunnelHost = settings.tunnelUrl ? new URL(settings.tunnelUrl).hostname.toLowerCase() : "";
  const tailscaleHost = settings.tailscaleUrl ? new URL(settings.tailscaleUrl).hostname.toLowerCase() : "";
  return (tunnelHost && host === tunnelHost) || (tailscaleHost && host === tailscaleHost);
}

export async function POST(request) {
  try {
    const ip = getClientIp(request);
    const lock = checkLock(ip);
    if (lock.locked) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${lock.retryAfter}s.`, retryAfter: lock.retryAfter, resetHint: RESET_HINT },
        { status: 429, headers: { ...NO_STORE_HEADERS, "Retry-After": String(lock.retryAfter) } },
      );
    }

    const { password } = await request.json();
    const settings = await getSettings();
    if (isTunnelRequest(request, settings) && settings.tunnelDashboardAccess !== true) {
      return NextResponse.json({ error: "Dashboard access via tunnel is disabled" }, { status: 403, headers: NO_STORE_HEADERS });
    }

    if (settings.authMode === "oidc" && isOidcConfigured(settings)) {
      return NextResponse.json({ error: "Password login is disabled. Use OIDC sign in." }, { status: 403, headers: NO_STORE_HEADERS });
    }

    const storedHash = settings.password;
    const initialPassword = process.env.INITIAL_PASSWORD || "123456";
    const valid = storedHash
      ? await bcrypt.compare(password, storedHash)
      : password === initialPassword;

    if (valid) {
      recordSuccess(ip);
      const cookieStore = await cookies();
      await setDashboardAuthCookie(cookieStore, request);
      // A built-in default is never allowed to become a persistent dashboard
      // credential, even on loopback. Explicit INITIAL_PASSWORD remains an
      // operator-controlled bootstrap choice and is not forcibly replaced.
      const mustChangePassword = !storedHash && !process.env.INITIAL_PASSWORD;
      return NextResponse.json({ success: true, mustChangePassword }, { headers: NO_STORE_HEADERS });
    }

    const { remainingBeforeLock } = recordFail(ip);
    const postLock = checkLock(ip);
    if (postLock.locked) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${postLock.retryAfter}s.`, retryAfter: postLock.retryAfter, resetHint: RESET_HINT },
        { status: 429, headers: { ...NO_STORE_HEADERS, "Retry-After": String(postLock.retryAfter) } },
      );
    }
    return NextResponse.json(
      { error: `Invalid password. ${remainingBeforeLock} attempt(s) left before lockout.` },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  } catch {
    return NextResponse.json({ error: "Login could not be completed" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
