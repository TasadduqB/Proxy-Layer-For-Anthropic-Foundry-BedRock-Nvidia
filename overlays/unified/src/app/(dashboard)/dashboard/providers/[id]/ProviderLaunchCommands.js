"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card } from "@/shared/components";

const DEFAULT_BASE_URL = "http://127.0.0.1:8787";
const DEFAULT_API_KEY = "sk_proxy-max";

function normalizeBaseUrl(value) {
  const cleaned = (value || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  return cleaned.endsWith("/v1") ? cleaned.slice(0, -3) : cleaned;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function CommandCard({ title, subtitle, command, copied, onCopy, badge }) {
  return (
    <div className="flex min-w-0 flex-col rounded-xl border border-border bg-black/[0.015] p-3 dark:bg-white/[0.025]">
      <div className="mb-2 flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-text-main">{title}</h3>
            {badge && (
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                {badge}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border bg-background px-2 py-1 text-xs text-text-muted transition-colors hover:border-primary/40 hover:text-primary"
          aria-label={`Copy ${title} command`}
        >
          <span className="material-symbols-outlined text-[14px]">{copied ? "check" : "content_copy"}</span>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="mt-auto max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-[#0b1020] p-3 text-[11px] leading-relaxed text-slate-100">
        <code>{command}</code>
      </pre>
    </div>
  );
}

export default function ProviderLaunchCommands({ providerName, models = [] }) {
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [apiKey, setApiKey] = useState(DEFAULT_API_KEY);
  const [selectedModel, setSelectedModel] = useState(models[0] || "");
  const [copiedId, setCopiedId] = useState("");

  const modelKey = models.join("\u0000");

  useEffect(() => {
    if (typeof window !== "undefined" && window.location?.origin) {
      setBaseUrl(window.location.origin);
    }
  }, []);

  useEffect(() => {
    if (!models.includes(selectedModel)) setSelectedModel(models[0] || "");
  }, [modelKey, models, selectedModel]);

  const commands = useMemo(() => {
    if (!selectedModel) return [];

    const proxyBase = normalizeBaseUrl(baseUrl);
    const openAiBase = `${proxyBase}/v1`;
    const key = apiKey.trim() || DEFAULT_API_KEY;
    const openCodeConfig = {
      $schema: "https://opencode.ai/config.json",
      provider: {
        "proxy-max": {
          npm: "@ai-sdk/openai-compatible",
          options: { baseURL: openAiBase, apiKey: key },
          models: {
            [selectedModel]: { name: selectedModel },
          },
        },
      },
      model: `proxy-max/${selectedModel}`,
      permission: "allow",
    };

    return [
      {
        id: "claude",
        title: "Claude Code",
        subtitle: "Starts the full interactive CLI; Proxy Max resolves model aliases, combos, fallback, and rotation.",
        badge: "Server-routed",
        command: [
          // Claude Code appends /v1/messages itself, so its base URL must be
          // the gateway root rather than Proxy Max's OpenAI-style /v1 URL.
          // Clear inherited model overrides so every model decision stays in
          // Proxy Max even when the user's shell has legacy Claude variables.
          "env",
          "-u ANTHROPIC_MODEL",
          "-u ANTHROPIC_DEFAULT_OPUS_MODEL",
          "-u ANTHROPIC_DEFAULT_SONNET_MODEL",
          "-u ANTHROPIC_DEFAULT_FABLE_MODEL",
          "-u ANTHROPIC_DEFAULT_HAIKU_MODEL",
          `ANTHROPIC_BASE_URL=${shellQuote(proxyBase)}`,
          `ANTHROPIC_AUTH_TOKEN=${shellQuote(key)}`,
          "claude --dangerously-skip-permissions",
        ].join(" \\\n  "),
      },
      {
        id: "codex",
        title: "Codex CLI",
        subtitle: "One-shot provider configuration using Proxy Max's Responses endpoint.",
        badge: "Sandbox + approvals bypassed",
        command: [
          `OPENAI_API_KEY=${shellQuote(key)}`,
          "codex",
          `--model ${shellQuote(selectedModel)}`,
          "--dangerously-bypass-approvals-and-sandbox",
          `-c ${shellQuote('model_provider="proxy-max"')}`,
          `-c ${shellQuote('model_providers.proxy-max.name="Proxy Max"')}`,
          `-c ${shellQuote(`model_providers.proxy-max.base_url="${openAiBase}"`)}`,
          `-c ${shellQuote('model_providers.proxy-max.env_key="OPENAI_API_KEY"')}`,
          `-c ${shellQuote('model_providers.proxy-max.wire_api="responses"')}`,
        ].join(" \\\n  "),
      },
      {
        id: "opencode",
        title: "OpenCode",
        subtitle: "Inline provider config; auto-approves every permission for this process.",
        badge: "All permissions allowed",
        command: [
          `OPENCODE_CONFIG_CONTENT=${shellQuote(JSON.stringify(openCodeConfig))}`,
          `OPENCODE_PERMISSION=${shellQuote(JSON.stringify({ "*": "allow" }))}`,
          `opencode --model ${shellQuote(`proxy-max/${selectedModel}`)} --auto`,
        ].join(" \\\n  "),
      },
      {
        id: "cursor",
        title: "Cursor Agent",
        subtitle: "Configure Cursor under CLI Tools first; Cursor Agent has no documented custom-base-URL flag.",
        badge: "Force mode",
        command: "cursor-agent --force",
      },
    ];
  }, [apiKey, baseUrl, selectedModel]);

  const handleCopy = async (id, command) => {
    await navigator.clipboard.writeText(command);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId((current) => current === id ? "" : current), 1800);
  };

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">Launch with Proxy Max</h2>
              <span className="rounded-full border border-red-500/25 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-600 dark:text-red-300">
                Dangerous mode on
              </span>
            </div>
            <p className="mt-1 text-sm text-text-muted">
              Copy a ready-to-run command for {providerName}. Change the endpoint or key when API-key enforcement or a tunnel is enabled.
            </p>
          </div>
          <Link
            href="/dashboard/cli-tools"
            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            Full CLI setup
            <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
          </Link>
        </div>

        <div className="rounded-lg border border-red-500/20 bg-red-500/[0.06] px-3 py-2 text-xs leading-relaxed text-red-700 dark:text-red-300">
          These commands intentionally remove approval and sandbox protections where the CLI supports it. Run them only inside a trusted repository and an externally isolated environment.
        </div>

        {models.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-text-muted">
            Add or import an LLM model above to generate launch commands.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              <label className="flex min-w-0 flex-col gap-1 text-xs text-text-muted lg:col-span-1">
                Pinned model (Codex/OpenCode)
                <select
                  value={selectedModel}
                  onChange={(event) => setSelectedModel(event.target.value)}
                  className="min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-main focus:border-primary focus:outline-none"
                >
                  {models.map((model) => <option key={model} value={model}>{model}</option>)}
                </select>
              </label>
              <label className="flex min-w-0 flex-col gap-1 text-xs text-text-muted">
                Proxy endpoint
                <input
                  type="url"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  className="min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-main focus:border-primary focus:outline-none"
                  spellCheck={false}
                />
              </label>
              <label className="flex min-w-0 flex-col gap-1 text-xs text-text-muted">
                Proxy API key
                <input
                  type="text"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  className="min-w-0 rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-text-main focus:border-primary focus:outline-none"
                  spellCheck={false}
                />
              </label>
            </div>

            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {commands.map((entry) => (
                <CommandCard
                  key={entry.id}
                  {...entry}
                  copied={copiedId === entry.id}
                  onCopy={() => handleCopy(entry.id, entry.command)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
