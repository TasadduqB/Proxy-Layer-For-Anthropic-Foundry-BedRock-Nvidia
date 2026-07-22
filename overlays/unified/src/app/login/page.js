"use client";

import { useEffect, useState } from "react";
import { Button, Input } from "@/shared/components";

export default function LoginPage() {
  const [status, setStatus] = useState(null);
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [mustChange, setMustChange] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resetHint, setResetHint] = useState("");
  const [retryAfter, setRetryAfter] = useState(0);

  useEffect(() => {
    if (retryAfter <= 0) return undefined;
    const timer = setInterval(() => setRetryAfter(value => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [retryAfter]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    fetch("/api/auth/status", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("status unavailable");
        return response.json();
      })
      .then(data => {
        if (data.requireLogin === false) {
          globalThis.location.assign("/dashboard");
          return;
        }
        setStatus(data);
      })
      .catch(() => setStatus({
        requireLogin: true,
        authMode: "password",
        oidcConfigured: false,
        hasPassword: true,
      }))
      .finally(() => clearTimeout(timeout));
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  const oidcAvailable = status?.oidcConfigured && ["oidc", "both"].includes(status?.authMode);
  const passwordAvailable = status?.authMode !== "oidc" || !status?.oidcConfigured;

  async function login(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResetHint("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await response.json();
      if (response.ok) {
        if (data.mustChangePassword) setMustChange(true);
        else globalThis.location.assign("/dashboard");
        return;
      }
      setError(data.error || "Sign-in failed");
      setResetHint(data.resetHint || "");
      setRetryAfter(Number(data.retryAfter) || 0);
    } catch {
      setError("Proxy Max could not be reached. Check the local runtime and retry.");
    } finally {
      setLoading(false);
    }
  }

  async function setFirstPassword(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: password, newPassword }),
      });
      if (response.ok) {
        globalThis.location.assign("/dashboard");
        return;
      }
      const data = await response.json();
      setError(data.error || "The new password could not be saved");
    } catch {
      setError("The new password could not be saved. Retry from the local host.");
    } finally {
      setLoading(false);
    }
  }

  if (!status) {
    return (
      <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-bg p-5" aria-busy="true">
        <div className="landing-grid absolute inset-0" aria-hidden="true" />
        <div className="relative text-center">
          <span className="material-symbols-outlined animate-spin text-3xl text-primary" aria-hidden="true">progress_activity</span>
          <p className="mt-3 text-sm text-text-muted">Opening the local control plane…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-bg p-5 sm:p-8">
      <div className="landing-grid absolute inset-0" aria-hidden="true" />
      <div className="pointer-events-none absolute -left-32 top-1/4 size-80 rounded-full bg-brand-500/10 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute -right-36 bottom-1/4 size-96 rounded-full bg-blue-500/[0.08] blur-3xl" aria-hidden="true" />

      <div className="relative grid w-full max-w-4xl overflow-hidden rounded-[24px] border border-border-subtle bg-surface/90 shadow-[var(--shadow-elev)] backdrop-blur-xl md:grid-cols-[1.05fr_.95fr]">
        <section className="hidden flex-col justify-between border-r border-border-subtle bg-gradient-to-br from-brand-500/[0.16] via-surface to-surface p-9 md:flex">
          <div>
            <div className="flex items-center gap-3">
              <img src="/favicon.svg" alt="" className="size-11 drop-shadow-[0_12px_20px_rgba(79,70,229,0.3)]" aria-hidden="true" />
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-text-main">Proxy Max</h1>
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-text-subtle">Local AI control plane</p>
              </div>
            </div>
            <h2 className="mt-10 max-w-sm text-3xl font-semibold tracking-[-0.04em] text-text-main">
              One secure gateway for every model workflow.
            </h2>
            <p className="mt-3 max-w-sm text-sm leading-6 text-text-muted">
              Configure providers, routing, proxy pools, usage controls, and multimodal endpoints without sending dashboard telemetry away from this host.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs text-text-muted">
            {[
              ["lock", "Encrypted credentials"],
              ["lan", "Loopback by default"],
              ["swap_horiz", "Protocol translation"],
              ["monitoring", "Observable routing"],
            ].map(([icon, label]) => (
              <div key={label} className="flex items-center gap-2 rounded-[10px] bg-bg/50 px-3 py-2">
                <span className="material-symbols-outlined text-[16px] text-primary" aria-hidden="true">{icon}</span>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="p-6 sm:p-9">
          <div className="mb-7 md:hidden">
            <div className="flex items-center gap-3">
              <img src="/favicon.svg" alt="" className="size-10 drop-shadow-[0_10px_16px_rgba(79,70,229,0.25)]" aria-hidden="true" />
              <div>
                <h1 className="text-lg font-semibold text-text-main">Proxy Max</h1>
                <p className="text-[10px] uppercase tracking-[0.14em] text-text-subtle">Local AI control plane</p>
              </div>
            </div>
          </div>

          <div className="mb-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
              {mustChange ? "First-run security" : "Protected dashboard"}
            </p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight text-text-main">
              {mustChange ? "Choose a private password" : "Sign in to continue"}
            </h2>
            <p className="mt-2 text-sm leading-5 text-text-muted">
              {mustChange
                ? "The built-in bootstrap password cannot remain active. Your new password is stored as a one-way hash."
                : "Authentication stays on this Proxy Max instance."}
            </p>
          </div>

          {error ? (
            <div className="mb-4 rounded-[10px] border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-600 dark:text-red-300" role="alert">
              {error}
            </div>
          ) : null}

          {mustChange ? (
            <form onSubmit={setFirstPassword} className="space-y-4">
              <Input
                label="New password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={event => setNewPassword(event.target.value)}
                placeholder="Use a long, unique password"
                required
                autoFocus
              />
              <Button type="submit" variant="primary" fullWidth loading={loading} disabled={newPassword.length < 8}>
                Secure dashboard
              </Button>
              <p className="text-center text-[11px] text-text-subtle">At least 8 characters.</p>
            </form>
          ) : (
            <div className="space-y-4">
              {oidcAvailable ? (
                <Button type="button" variant="primary" fullWidth onClick={() => { globalThis.location.href = "/api/auth/oidc/start"; }}>
                  {status.oidcLoginLabel || "Sign in with OIDC"}
                </Button>
              ) : null}

              {oidcAvailable && passwordAvailable ? (
                <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.14em] text-text-subtle">
                  <span className="h-px flex-1 bg-border-subtle" />or use a password<span className="h-px flex-1 bg-border-subtle" />
                </div>
              ) : null}

              {passwordAvailable ? (
                <form onSubmit={login} className="space-y-4">
                  <Input
                    label="Password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={event => setPassword(event.target.value)}
                    placeholder="Enter dashboard password"
                    required
                    autoFocus={!oidcAvailable}
                  />
                  {retryAfter > 0 ? (
                    <p className="text-xs text-amber-600 dark:text-amber-300">Locked for {retryAfter}s after repeated failures.</p>
                  ) : null}
                  {resetHint ? <p className="break-words text-[11px] leading-5 text-text-muted">{resetHint}</p> : null}
                  <Button type="submit" variant="primary" fullWidth loading={loading} disabled={retryAfter > 0}>
                    {retryAfter > 0 ? `Retry in ${retryAfter}s` : "Sign in"}
                  </Button>
                </form>
              ) : null}

              {!status.hasPassword && passwordAvailable ? (
                <div className="rounded-[10px] border border-amber-500/20 bg-amber-500/[0.08] px-3 py-2 text-[11px] leading-5 text-amber-700 dark:text-amber-300">
                  First run: use <code className="rounded bg-amber-500/10 px-1 font-mono">INITIAL_PASSWORD</code>, or <code className="rounded bg-amber-500/10 px-1 font-mono">123456</code> when none was configured. You will immediately choose a private password.
                </div>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
