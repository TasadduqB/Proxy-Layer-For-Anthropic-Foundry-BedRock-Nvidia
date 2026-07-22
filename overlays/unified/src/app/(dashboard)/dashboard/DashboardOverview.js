"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Badge from "@/shared/components/Badge";
import Card from "@/shared/components/Card";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

const ENDPOINTS = [
  {
    id: "openai",
    label: "OpenAI compatible",
    path: "/v1/chat/completions",
    icon: "forum",
    tone: "from-sky-500/15 to-blue-500/5 text-sky-600 dark:text-sky-400",
  },
  {
    id: "anthropic",
    label: "Anthropic Messages",
    path: "/v1/messages",
    icon: "neurology",
    tone: "from-orange-500/15 to-amber-500/5 text-orange-600 dark:text-orange-400",
  },
  {
    id: "responses",
    label: "OpenAI Responses",
    path: "/v1/responses",
    icon: "account_tree",
    tone: "from-violet-500/15 to-purple-500/5 text-violet-600 dark:text-violet-400",
  },
  {
    id: "gemini",
    label: "Gemini compatible",
    path: "/v1beta/models",
    icon: "auto_awesome",
    tone: "from-emerald-500/15 to-teal-500/5 text-emerald-600 dark:text-emerald-400",
  },
];

const FAILURE_STATUSES = new Set(["error", "invalid", "disabled", "failed"]);

function compactNumber(value) {
  return new Intl.NumberFormat(undefined, {
    notation: Number(value) >= 10000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(Number(value) || 0);
}

function money(value) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Number(value) < 1 ? 4 : 2,
  }).format(Number(value) || 0);
}

function timeAgo(timestamp) {
  if (!timestamp) return "Just now";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

async function getJson(path, signal) {
  const response = await fetch(path, { cache: "no-store", signal });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

function Metric({ icon, label, value, detail, tone }) {
  return (
    <Card padding="sm" hover className="min-w-0">
      <div className="flex items-center gap-3">
        <span
          className={`material-symbols-outlined flex size-10 shrink-0 items-center justify-center rounded-[13px] ${tone}`}
          aria-hidden="true"
        >
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium text-text-muted">{label}</p>
          <p className="mt-1 truncate text-2xl font-semibold tracking-tight text-text-main">
            {value}
          </p>
          <p className="mt-1 truncate text-[11px] text-text-subtle">{detail}</p>
        </div>
      </div>
    </Card>
  );
}

function EmptyState({ icon, title, description, href, action }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center px-5 py-8 text-center">
      <span className="material-symbols-outlined mb-3 text-3xl text-text-subtle" aria-hidden="true">
        {icon}
      </span>
      <h3 className="text-sm font-semibold text-text-main">{title}</h3>
      <p className="mt-1 max-w-sm text-xs leading-5 text-text-muted">{description}</p>
      {href ? (
        <Link
          href={href}
          className="button-primary mt-4 inline-flex h-9 items-center gap-1.5 rounded-[11px] px-3 text-xs font-semibold text-white transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {action}
          <span className="material-symbols-outlined text-[15px]" aria-hidden="true">arrow_forward</span>
        </Link>
      ) : null}
    </div>
  );
}

export default function DashboardOverview() {
  const [snapshot, setSnapshot] = useState({
    connections: [],
    models: [],
    keys: [],
    stats: {},
    settings: {},
    online: false,
  });
  const [baseUrl, setBaseUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [warning, setWarning] = useState("");
  const { copied, copy } = useCopyToClipboard();

  const load = useCallback(async ({ background = false } = {}) => {
    const controller = new AbortController();
    if (background) setRefreshing(true);
    else setLoading(true);

    const requests = [
      ["health", "/api/health"],
      ["providers", "/api/providers"],
      ["models", "/api/models"],
      ["keys", "/api/keys"],
      ["stats", "/api/usage/stats?period=24h"],
      ["settings", "/api/settings"],
    ];

    const results = await Promise.allSettled(
      requests.map(([, path]) => getJson(path, controller.signal)),
    );
    const values = Object.fromEntries(
      results.map((result, index) => [
        requests[index][0],
        result.status === "fulfilled" ? result.value : null,
      ]),
    );
    const failures = results.filter((result) => result.status === "rejected").length;

    setSnapshot((current) => ({
      connections: values.providers?.connections ?? current.connections,
      models: values.models?.models ?? current.models,
      keys: values.keys?.keys ?? current.keys,
      stats: values.stats ?? current.stats,
      settings: values.settings ?? current.settings,
      online: values.health?.ok === true,
    }));
    setWarning(
      failures === requests.length
        ? "The control plane could not be reached. Check the local runtime and try again."
        : failures > 0
          ? `${failures} dashboard data source${failures === 1 ? " is" : "s are"} temporarily unavailable.`
          : "",
    );
    setLoading(false);
    setRefreshing(false);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    setBaseUrl(window.location.origin);
    load();
  }, [load]);

  const summary = useMemo(() => {
    const activeConnections = snapshot.connections.filter((item) => item.isActive !== false);
    const unhealthy = activeConnections.filter((item) =>
      FAILURE_STATUSES.has(String(item.testStatus || "").toLowerCase()),
    );
    const providers = new Set(activeConnections.map((item) => item.provider));
    const totalTokens =
      (snapshot.stats.totalPromptTokens || 0) +
      (snapshot.stats.totalCompletionTokens || 0);
    return {
      activeConnections,
      unhealthy,
      providerCount: providers.size,
      totalTokens,
    };
  }, [snapshot]);

  const setupSteps = [
    {
      label: "Connect at least one provider",
      complete: summary.activeConnections.length > 0,
      href: "/dashboard/providers",
    },
    {
      label: "Make a routed model available",
      complete: snapshot.models.length > 0,
      href: "/dashboard/providers",
    },
    {
      label: "Protect the API with a key",
      complete: snapshot.settings.requireApiKey === true && snapshot.keys.length > 0,
      href: "/dashboard/endpoint",
    },
    {
      label: "Secure dashboard access",
      complete: snapshot.settings.hasPassword === true || snapshot.settings.oidcConfigured === true,
      href: "/dashboard/profile",
    },
  ];
  const completedSetup = setupSteps.filter((step) => step.complete).length;

  if (loading) {
    return (
      <div className="space-y-5" aria-busy="true" aria-label="Loading dashboard">
        <div className="h-44 animate-pulse rounded-[20px] bg-surface-2" />
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-28 animate-pulse rounded-[14px] bg-surface-2" />
          ))}
        </div>
        <div className="grid gap-4 xl:grid-cols-[1.35fr_.65fr]">
          <div className="h-80 animate-pulse rounded-[14px] bg-surface-2" />
          <div className="h-80 animate-pulse rounded-[14px] bg-surface-2" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-8">
      {warning ? (
        <div
          className="flex items-start gap-2 rounded-[12px] border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
          role="status"
        >
          <span className="material-symbols-outlined text-[17px]" aria-hidden="true">warning</span>
          <span className="flex-1">{warning}</span>
          <button
            type="button"
            onClick={() => load({ background: true })}
            className="font-semibold underline decoration-current/30 underline-offset-2"
          >
            Retry
          </button>
        </div>
      ) : null}

      <section className="hero-panel relative overflow-hidden rounded-[24px] border px-5 py-7 sm:px-8 sm:py-8">
        <div className="pointer-events-none absolute -right-20 -top-28 size-72 rounded-full bg-cyan-300/20 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-24 right-1/3 size-52 rounded-full bg-violet-300/20 blur-3xl" aria-hidden="true" />
        <div className="relative flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div className="max-w-2xl">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge variant={snapshot.online ? "success" : "error"} dot>
                {snapshot.online ? "Gateway online" : "Gateway unavailable"}
              </Badge>
              <Badge variant={snapshot.settings.requireApiKey ? "primary" : "warning"} icon="key">
                API key {snapshot.settings.requireApiKey ? "required" : "optional"}
              </Badge>
              {snapshot.settings.outboundProxyEnabled ? (
                <Badge variant="info" icon="route">Outbound proxy active</Badge>
              ) : null}
            </div>
            <h2 className="text-2xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">
              One endpoint. Every model.
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-indigo-100/85">
              Route OpenAI, Anthropic, Gemini, image, audio, video, search, and embedding workloads through one observable control plane.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/dashboard/providers"
              className="inline-flex h-10 items-center gap-2 rounded-[12px] bg-white px-4 text-sm font-semibold text-indigo-700 shadow-[0_10px_24px_-12px_rgba(0,0,0,0.6)] transition hover:-translate-y-0.5 hover:bg-indigo-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">add_circle</span>
              Add provider
            </Link>
            <button
              type="button"
              onClick={() => load({ background: true })}
              disabled={refreshing}
              className="inline-flex h-10 items-center gap-2 rounded-[12px] border border-white/20 bg-white/10 px-4 text-sm font-semibold text-white backdrop-blur transition hover:-translate-y-0.5 hover:bg-white/16 disabled:opacity-60"
            >
              <span className={`material-symbols-outlined text-[18px] ${refreshing ? "animate-spin" : ""}`} aria-hidden="true">refresh</span>
              Refresh
            </button>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Last 24 hours">
        <Metric
          icon="hub"
          label="Active connections"
          value={compactNumber(summary.activeConnections.length)}
          detail={`${summary.providerCount} provider${summary.providerCount === 1 ? "" : "s"}${summary.unhealthy.length ? ` · ${summary.unhealthy.length} need attention` : " · routing ready"}`}
          tone="bg-brand-500/10 text-brand-600 dark:text-brand-300"
        />
        <Metric
          icon="smart_toy"
          label="Available models"
          value={compactNumber(snapshot.models.length)}
          detail="Chat and multimodal catalog"
          tone="bg-blue-500/10 text-blue-600 dark:text-blue-400"
        />
        <Metric
          icon="swap_horiz"
          label="Requests · 24h"
          value={compactNumber(snapshot.stats.totalRequests)}
          detail={`${compactNumber(summary.totalTokens)} tokens processed`}
          tone="bg-violet-500/10 text-violet-600 dark:text-violet-400"
        />
        <Metric
          icon="payments"
          label="Estimated cost · 24h"
          value={money(snapshot.stats.totalCost)}
          detail={`${snapshot.stats.totalCachedTokens ? `${compactNumber(snapshot.stats.totalCachedTokens)} cached tokens` : "Usage metering enabled"}`}
          tone="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.35fr_.65fr]">
        <Card
          title="Protocol endpoints"
          subtitle="Drop-in APIs for the clients you already use"
          icon="route"
          action={
            <Link href="/dashboard/endpoint" className="text-xs font-semibold text-primary hover:underline">
              Manage access
            </Link>
          }
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {ENDPOINTS.map((endpoint) => {
              const value = `${baseUrl}${endpoint.path}`;
              return (
                <button
                  key={endpoint.id}
                  type="button"
                  onClick={() => copy(value, endpoint.id)}
                  className="group flex min-w-0 items-center gap-3 rounded-[12px] border border-border-subtle bg-bg/70 p-3 text-left transition hover:-translate-y-0.5 hover:border-brand-500/30 hover:bg-surface hover:shadow-[var(--shadow-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  aria-label={`Copy ${endpoint.label} endpoint`}
                >
                  <span className={`material-symbols-outlined flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br ${endpoint.tone}`} aria-hidden="true">
                    {endpoint.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-text-main">{endpoint.label}</span>
                    <code className="mt-0.5 block truncate text-[11px] text-text-muted">{endpoint.path}</code>
                  </span>
                  <span className="material-symbols-outlined text-[17px] text-text-subtle transition group-hover:text-primary" aria-hidden="true">
                    {copied === endpoint.id ? "check" : "content_copy"}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-[10px] bg-surface-2/60 px-3 py-2">
            <span className="material-symbols-outlined text-[16px] text-text-subtle" aria-hidden="true">link</span>
            <code className="min-w-0 flex-1 truncate text-[11px] text-text-muted">{baseUrl || "Local gateway URL"}</code>
            <button
              type="button"
              onClick={() => copy(baseUrl, "base")}
              className="text-[11px] font-semibold text-primary hover:underline"
            >
              {copied === "base" ? "Copied" : "Copy base URL"}
            </button>
          </div>
        </Card>

        <Card
          title="Production readiness"
          subtitle={`${completedSetup} of ${setupSteps.length} safeguards complete`}
          icon="task_alt"
        >
          <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-500 to-orange-400 transition-all"
              style={{ width: `${(completedSetup / setupSteps.length) * 100}%` }}
            />
          </div>
          <div className="space-y-1">
            {setupSteps.map((step) => (
              <Link
                key={step.label}
                href={step.href}
                className="group flex items-center gap-2 rounded-[9px] px-2 py-2 text-xs transition hover:bg-surface-2"
              >
                <span className={`material-symbols-outlined text-[18px] ${step.complete ? "text-emerald-500" : "text-text-subtle"}`} aria-hidden="true">
                  {step.complete ? "check_circle" : "radio_button_unchecked"}
                </span>
                <span className={`min-w-0 flex-1 ${step.complete ? "text-text-muted" : "font-medium text-text-main"}`}>
                  {step.label}
                </span>
                <span className="material-symbols-outlined text-[15px] text-text-subtle opacity-0 transition group-hover:opacity-100" aria-hidden="true">chevron_right</span>
              </Link>
            ))}
          </div>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[.8fr_1.2fr]">
        <Card
          title="Connected providers"
          subtitle="Active routing identities"
          icon="dns"
          action={
            <Link href="/dashboard/providers" className="text-xs font-semibold text-primary hover:underline">View all</Link>
          }
        >
          {summary.activeConnections.length ? (
            <div className="divide-y divide-border-subtle px-5 pb-2">
              {summary.activeConnections.slice(0, 6).map((connection) => {
                const provider = AI_PROVIDERS[connection.provider];
                const failed = FAILURE_STATUSES.has(String(connection.testStatus || "").toLowerCase());
                return (
                  <Link
                    key={connection.id}
                    href={`/dashboard/providers/${connection.provider}`}
                    className="group flex items-center gap-3 py-3"
                  >
                    <ProviderIcon
                      providerId={connection.provider}
                      alt=""
                      size={30}
                      fallbackText={(provider?.name || connection.provider).slice(0, 2).toUpperCase()}
                      className="rounded-[8px] bg-surface-2 object-contain"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-text-main">
                        {connection.name || provider?.name || connection.provider}
                      </span>
                      <span className="block truncate text-[11px] text-text-muted">
                        {provider?.name || connection.provider}
                      </span>
                    </span>
                    <Badge size="sm" variant={failed ? "error" : "success"} dot>
                      {failed ? "Attention" : "Active"}
                    </Badge>
                  </Link>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon="add_link"
              title="No providers connected"
              description="Connect an account or API key to make your first model route available."
              href="/dashboard/providers"
              action="Connect provider"
            />
          )}
        </Card>

        <Card
          title="Recent requests"
          subtitle="Latest metered model activity"
          icon="history"
          action={
            <Link href="/dashboard/usage" className="text-xs font-semibold text-primary hover:underline">Open analytics</Link>
          }
        >
          {snapshot.stats.recentRequests?.length ? (
            <div className="divide-y divide-border-subtle px-5 pb-2">
              {snapshot.stats.recentRequests.slice(0, 6).map((request, index) => {
                const failed = String(request.status || "").toLowerCase() === "error";
                return (
                  <div key={`${request.timestamp}-${request.model}-${index}`} className="flex items-center gap-3 py-3">
                    <span className={`material-symbols-outlined flex size-8 shrink-0 items-center justify-center rounded-[9px] text-[17px] ${failed ? "bg-red-500/10 text-red-500" : "bg-emerald-500/10 text-emerald-500"}`} aria-hidden="true">
                      {failed ? "error" : "check"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-text-main">{request.model || "Unknown model"}</span>
                      <span className="block truncate text-[11px] text-text-muted">{request.provider || "Routed provider"}</span>
                    </span>
                    <span className="text-right">
                      <span className="block text-[11px] font-medium tabular-nums text-text-main">
                        {compactNumber((request.promptTokens || 0) + (request.completionTokens || 0))} tokens
                      </span>
                      <span className="block text-[10px] text-text-subtle">{timeAgo(request.timestamp)}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon="monitoring"
              title="No requests yet"
              description="Traffic will appear here after a client sends its first request through Proxy Max."
              href="/dashboard/basic-chat"
              action="Try the playground"
            />
          )}
        </Card>
      </section>
    </div>
  );
}
