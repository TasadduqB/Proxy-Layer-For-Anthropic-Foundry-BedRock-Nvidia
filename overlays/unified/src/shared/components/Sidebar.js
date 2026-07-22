"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/shared/utils/cn";
import { APP_CONFIG, UPDATER_CONFIG } from "@/shared/constants/config";
import { MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers";

// Only surface media kinds backed by a public runtime endpoint.
const VISIBLE_MEDIA_KINDS = ["embedding", "image", "video", "tts", "stt"];
// Combined entry: webSearch + webFetch share one page at /dashboard/media-providers/web
const COMBINED_WEB_ITEM = { id: "web", label: "Web Fetch & Search", icon: "travel_explore", href: "/dashboard/media-providers/web" };

const navItems = [
  { href: "/dashboard", label: "Overview", icon: "space_dashboard" },
  { href: "/dashboard/endpoint", label: "Endpoint & Key", icon: "api" },
  { href: "/dashboard/providers", label: "Providers", icon: "dns" },
  { href: "/dashboard/combos", label: "Combos", icon: "layers" },
  { href: "/dashboard/basic-chat", label: "Playground", icon: "chat" },
  { href: "/dashboard/usage", label: "Usage", icon: "bar_chart" },
  { href: "/dashboard/quota", label: "Quota Tracker", icon: "data_usage" },
];

const debugItems = [
  { href: "/dashboard/console-log", label: "Console Log", icon: "terminal" },
  { href: "/dashboard/translator", label: "Translator", icon: "translate" },
];

const systemItems = [
  { href: "/dashboard/proxy-pools", label: "Proxy Pools", icon: "lan" },
  { href: "/dashboard/token-saver", label: "Token Saver", icon: "savings" },
  { href: "/dashboard/cli-tools", label: "CLI Tools", icon: "terminal" },
  { href: "/dashboard/pxpipe", label: "PXPIPE", icon: "image" },
  { href: "/dashboard/skills", label: "Skills", icon: "extension" },
];

export default function Sidebar({ onClose }) {
  const pathname = usePathname();
  const [mediaOpen, setMediaOpen] = useState(() => pathname.startsWith("/dashboard/media-providers"));
  const [enableTranslator, setEnableTranslator] = useState(false);
  const [updateState, setUpdateState] = useState({
    kind: "idle",
    message: "Get the latest trusted code from GitHub.",
    info: null,
    phase: null,
    logs: [],
  });

  useEffect(() => {
    fetch("/api/settings")
      .then(res => res.json())
      .then(data => { if (data.enableTranslator) setEnableTranslator(true); })
      .catch(() => {});
  }, []);

  const isActive = (href) => {
    if (href === "/dashboard") return pathname === href;
    return pathname.startsWith(href);
  };

  const checkForUpdates = async () => {
    setUpdateState((current) => ({ ...current, kind: "checking", message: "Checking trusted Git source…", logs: [] }));
    try {
      const response = await fetch("/api/version", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Update check failed");
      if (!data.hasUpdate) {
        setUpdateState({ kind: "current", message: "Proxy Max is up to date.", info: data, phase: null, logs: [] });
      } else if (!data.canUpdate) {
        setUpdateState({ kind: "blocked", message: data.blockedReason || "Automatic update is unavailable.", info: data, phase: null, logs: [] });
      } else {
        const count = data.behind === 1 ? "1 commit" : `${data.behind} commits`;
        setUpdateState({ kind: "available", message: `Update available (${count}).`, info: data, phase: null, logs: [] });
      }
    } catch (error) {
      setUpdateState({ kind: "error", message: error?.message || "Update check failed", info: null, phase: null, logs: [] });
    }
  };

  const waitForRestart = async () => {
    setUpdateState((current) => ({ ...current, kind: "restarting", message: "Update complete. Waiting for Proxy Max…" }));
    for (let attempt = 0; attempt < 90; attempt += 1) {
      try {
        const response = await fetch("/login", { cache: "no-store" });
        if (response.ok) {
          window.location.reload();
          return;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    setUpdateState((current) => ({ ...current, kind: "updateError", message: "The update completed, but the app did not come back online. Start Proxy Max manually." }));
  };

  const pollUpdater = async (port) => {
    const statusUrl = `http://127.0.0.1:${port}/update/status`;
    let connectionMisses = 0;
    while (connectionMisses < 90) {
      try {
        const response = await fetch(statusUrl, { cache: "no-store" });
        if (!response.ok) throw new Error(`Updater status returned ${response.status}`);
        const status = await response.json();
        connectionMisses = 0;
        setUpdateState((current) => ({
          ...current,
          kind: status.done && !status.success ? "updateError" : "updating",
          message: status.error || "Applying the verified update…",
          phase: status.phase,
          logs: Array.isArray(status.logTail) ? status.logTail : [],
        }));
        if (status.done) {
          if (status.success) await waitForRestart();
          return;
        }
      } catch {
        connectionMisses += 1;
      }
      await new Promise((resolve) => setTimeout(resolve, UPDATER_CONFIG.statusPollIntervalMs));
    }
    setUpdateState((current) => ({ ...current, kind: "updateError", message: "Lost contact with the updater. Start Proxy Max manually if it does not restart." }));
  };

  const startUpdate = async () => {
    setUpdateState((current) => ({ ...current, kind: "updating", message: "Starting the verified updater…", phase: "starting", logs: [] }));
    try {
      const response = await fetch("/api/version/update", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.message || "Unable to start update");
      await pollUpdater(data.updaterPort || UPDATER_CONFIG.statusPort);
    } catch (error) {
      setUpdateState((current) => ({ ...current, kind: "updateError", message: error?.message || "Unable to start update" }));
    }
  };

  const updateBusy = ["checking", "updating", "restarting"].includes(updateState.kind);
  const updateAction = updateState.kind === "available" ? startUpdate : checkForUpdates;
  const updateLabel = updateState.kind === "available"
    ? "Update Proxy Max"
    : updateState.kind === "checking"
      ? "Checking…"
      : "Check for updates";
  const showUpdateOverlay = ["updating", "restarting", "updateError"].includes(updateState.kind);

  return (
    <>
      <aside className="app-sidebar flex min-h-full w-[272px] flex-col border-r backdrop-blur-2xl transition-colors duration-300">
        {/* Logo */}
        <div className="flex flex-col gap-2 px-4 pb-3 pt-4">
          <div className="flex items-center gap-2">
          <Link href="/dashboard" onClick={onClose} className="group flex min-w-0 flex-1 items-center gap-3 rounded-[12px] p-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
            <div className="relative flex size-10 shrink-0 items-center justify-center rounded-[13px] bg-gradient-to-br from-brand-500 via-indigo-500 to-cyan-500 shadow-[0_12px_28px_-12px_rgba(79,70,229,0.8)] transition-transform group-hover:scale-[1.04]">
              <span aria-hidden="true" className="material-symbols-outlined text-[21px] text-white">route</span>
              <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-surface bg-emerald-500" aria-label="Gateway online" />
            </div>
            <div className="flex min-w-0 flex-col">
              <h1 className="truncate text-[17px] font-semibold tracking-tight text-text-main">
                {APP_CONFIG.name}
              </h1>
              <span className="truncate text-[10px] font-medium uppercase tracking-[0.12em] text-text-subtle">Unified gateway · v{APP_CONFIG.version}</span>
            </div>
          </Link>
          {onClose ? (
            <button type="button" onClick={onClose} className="flex size-8 items-center justify-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-text-main lg:hidden" aria-label="Close navigation">
              <span aria-hidden="true" className="material-symbols-outlined text-[20px]">close</span>
            </button>
          ) : null}
          </div>
        </div>

        {/* Navigation */}
        <nav className="custom-scrollbar flex-1 space-y-0.5 overflow-y-auto px-3 py-2" aria-label="Primary navigation">
          <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-subtle">Workspace</p>
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={cn(
                "group flex items-center gap-3 rounded-[11px] px-3 py-2 transition-all",
                isActive(item.href)
                  ? "bg-gradient-to-r from-brand-500/15 to-cyan-500/[0.07] text-primary shadow-[inset_0_0_0_1px_rgba(99,102,241,0.10)]"
                  : "text-text-muted hover:bg-brand-500/[0.07] hover:text-text-main"
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "material-symbols-outlined text-[18px]",
                  isActive(item.href) ? "fill-1" : "group-hover:text-primary transition-colors"
                )}
              >
                {item.icon}
              </span>
              <span className="text-[13px] font-medium">{item.label}</span>
            </Link>
          ))}

          {/* System section */}
          <div className="mt-2 space-y-0.5 pt-3">
            <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-subtle">
              Routing & tools
            </p>

            {/* Media Providers accordion */}
            <button
              type="button"
              onClick={() => setMediaOpen((v) => !v)}
              aria-expanded={mediaOpen}
              aria-controls="media-provider-navigation"
              className={cn(
                "group flex w-full items-center gap-3 rounded-[11px] px-3 py-2 transition-all",
                pathname.startsWith("/dashboard/media-providers")
                  ? "bg-gradient-to-r from-brand-500/15 to-cyan-500/[0.07] text-primary"
                  : "text-text-muted hover:bg-brand-500/[0.07] hover:text-text-main"
              )}
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">perm_media</span>
              <span className="text-[13px] font-medium flex-1 text-left">Media Providers</span>
              <span aria-hidden="true" className="material-symbols-outlined text-[14px] transition-transform" style={{ transform: mediaOpen ? "rotate(180deg)" : "rotate(0deg)" }}>
                expand_more
              </span>
            </button>
            {mediaOpen && (
              <div id="media-provider-navigation" className="ml-4 border-l border-border-subtle pl-1">
                {MEDIA_PROVIDER_KINDS.filter((k) => VISIBLE_MEDIA_KINDS.includes(k.id)).map((kind) => (
                  <Link
                    key={kind.id}
                    href={`/dashboard/media-providers/${kind.id}`}
                    onClick={onClose}
                    className={cn(
                      "group flex items-center gap-3 rounded-[10px] px-3 py-1.5 transition-all",
                      pathname.startsWith(`/dashboard/media-providers/${kind.id}`)
                        ? "bg-gradient-to-r from-brand-500/15 to-cyan-500/[0.07] text-primary"
                        : "text-text-muted hover:bg-brand-500/[0.07] hover:text-text-main"
                    )}
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[16px]">{kind.icon}</span>
                    <span className="text-sm">{kind.label}</span>
                  </Link>
                ))}
                <Link
                  key={COMBINED_WEB_ITEM.id}
                  href={COMBINED_WEB_ITEM.href}
                  onClick={onClose}
                  className={cn(
                    "group flex items-center gap-3 rounded-[10px] px-3 py-1.5 transition-all",
                    pathname.startsWith(COMBINED_WEB_ITEM.href)
                      ? "bg-gradient-to-r from-brand-500/15 to-cyan-500/[0.07] text-primary"
                      : "text-text-muted hover:bg-brand-500/[0.07] hover:text-text-main"
                  )}
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[16px]">{COMBINED_WEB_ITEM.icon}</span>
                  <span className="text-sm">{COMBINED_WEB_ITEM.label}</span>
                </Link>
              </div>
            )}

            {systemItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={cn(
                  "group flex items-center gap-3 rounded-[11px] px-3 py-2 transition-all",
                  isActive(item.href)
                    ? "bg-gradient-to-r from-brand-500/15 to-cyan-500/[0.07] text-primary"
                    : "text-text-muted hover:bg-brand-500/[0.07] hover:text-text-main"
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "material-symbols-outlined text-[18px]",
                    isActive(item.href) ? "fill-1" : "group-hover:text-primary transition-colors"
                  )}
                >
                  {item.icon}
                </span>
                <span className="text-[13px] font-medium">{item.label}</span>
              </Link>
            ))}

            {/* Debug items (inside System section, before Settings) */}
            {debugItems.map((item) => {
              const show = item.href !== "/dashboard/translator" || enableTranslator;
              return show ? (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  aria-current={isActive(item.href) ? "page" : undefined}
                  className={cn(
                    "group flex items-center gap-3 rounded-[11px] px-3 py-2 transition-all",
                    isActive(item.href)
                      ? "bg-gradient-to-r from-brand-500/15 to-cyan-500/[0.07] text-primary"
                      : "text-text-muted hover:bg-brand-500/[0.07] hover:text-text-main"
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "material-symbols-outlined text-[18px]",
                      isActive(item.href) ? "fill-1" : "group-hover:text-primary transition-colors"
                    )}
                  >
                    {item.icon}
                  </span>
                  <span className="text-[13px] font-medium">{item.label}</span>
                </Link>
              ) : null;
            })}

            {/* Settings */}
            <Link
              href="/dashboard/profile"
              onClick={onClose}
              aria-current={isActive("/dashboard/profile") ? "page" : undefined}
              className={cn(
                "group flex items-center gap-3 rounded-[11px] px-3 py-2 transition-all",
                isActive("/dashboard/profile")
                  ? "bg-gradient-to-r from-brand-500/15 to-cyan-500/[0.07] text-primary"
                  : "text-text-muted hover:bg-brand-500/[0.07] hover:text-text-main"
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "material-symbols-outlined text-[18px]",
                  isActive("/dashboard/profile") ? "fill-1" : "group-hover:text-primary transition-colors"
                )}
              >
                settings
              </span>
              <span className="text-[13px] font-medium">Settings</span>
            </Link>
          </div>
        </nav>

        <div className="border-t border-border-subtle p-3">
          <div className="app-card rounded-[16px] p-3" aria-live="polite">
            <div className="flex items-start gap-2">
              <span aria-hidden="true" className="material-symbols-outlined mt-0.5 text-[17px] text-primary">system_update_alt</span>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold text-text-main">Application updates</p>
                <p className="mt-0.5 text-[10px] leading-4 text-text-muted">{updateState.message}</p>
                {updateState.info?.dirtyCount > 0 && updateState.kind === "blocked" ? (
                  <p className="mt-1 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                    {updateState.info.dirtyCount} local {updateState.info.dirtyCount === 1 ? "change" : "changes"} detected
                  </p>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              onClick={updateAction}
              disabled={updateBusy}
              className="button-primary mt-2 flex w-full items-center justify-center gap-1.5 rounded-[10px] px-3 py-2 text-[11px] font-semibold text-white transition-all disabled:cursor-wait disabled:opacity-60"
            >
              {updateBusy ? <span aria-hidden="true" className="material-symbols-outlined animate-spin text-[15px]">progress_activity</span> : null}
              {updateLabel}
            </button>
          </div>
        </div>

      </aside>

      {showUpdateOverlay ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="proxy-max-update-title">
          <div className="w-full max-w-lg rounded-2xl border border-border-subtle bg-surface p-5 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <span aria-hidden="true" className={cn("material-symbols-outlined", updateBusy && "animate-spin")}>{updateBusy ? "progress_activity" : "error"}</span>
              </div>
              <div>
                <h2 id="proxy-max-update-title" className="text-base font-semibold text-text-main">
                  {updateState.kind === "updateError" ? "Update needs attention" : "Updating Proxy Max"}
                </h2>
                <p className="text-xs text-text-muted">{updateState.message}</p>
              </div>
            </div>
            {updateState.phase ? (
              <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">{updateState.phase.replaceAll("-", " ")}</p>
            ) : null}
            {updateState.logs.length ? (
              <pre className="custom-scrollbar mt-2 max-h-52 overflow-auto whitespace-pre-wrap rounded-xl bg-black/90 p-3 text-[10px] leading-4 text-emerald-300">{updateState.logs.join("\n")}</pre>
            ) : null}
            <p className="mt-4 text-[11px] leading-4 text-text-muted">
              Keep this tab open. Proxy Max will rebuild and restart automatically.
            </p>
            {updateState.kind === "updateError" ? (
              <button type="button" onClick={() => window.location.reload()} className="mt-4 w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
                Reload application
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

    </>
  );
}

Sidebar.propTypes = {
  onClose: PropTypes.func,
};
