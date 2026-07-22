"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Button, Badge, Input, Modal, Select } from "@/shared/components";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { planBulkAdd } from "@/shared/utils/bulkAdd";

const BULK_PLACEHOLDER = `name1|sk-key1\nname2|sk-key2\nsk-key-only-auto-named`;

export default function AddApiKeyModal({ isOpen, provider, providerName, isCompatible, isAnthropic, authType, authHint, website, proxyPools, error, existingNames, onSave, onBulkDone, onClose }) {
  const NONE_PROXY_POOL_VALUE = "__none__";
  const isOllamaLocal = provider === "ollama-local";
  const isCookie = authType === "cookie";
  const isXaiApiKey = provider === "xai" && !isCookie;
  const isBedrock = provider === "bedrock";
  const credentialLabel = isCookie ? "Cookie Value" : (isBedrock ? "AWS Access Key ID" : "API Key");
  const credentialPlaceholder = isCookie
    ? (provider === "grok-web" ? "sso=xxxxx... or just the raw value" : "eyJhbGciOi...")
    : (isXaiApiKey ? "xai-..." : (isBedrock ? "AKIA..." : ""));

  const isAzure = provider === "azure";
  const isCloudflareAi = provider === "cloudflare-ai";
  const supportsBulk = !isAzure && !isBedrock;
  const providerRegions = AI_PROVIDERS?.[provider]?.regions || null;
  const defaultRegion = AI_PROVIDERS?.[provider]?.defaultRegion || providerRegions?.[0]?.id || "";

  const [formData, setFormData] = useState({
    name: "",
    apiKey: "",
    defaultModel: "",
    priority: 1,
    proxyPoolId: NONE_PROXY_POOL_VALUE,
    ollamaHostUrl: "",
  });
  const [azureData, setAzureData] = useState({
    apiType: "chat",
    endpointMode: "deployment",
    authMode: "api-key",
    azureEndpoint: "",
    apiVersion: "2024-10-01-preview",
    deployment: "",
    organization: "",
  });
  const [cloudflareData, setCloudflareData] = useState({ accountId: "" });
  const [bedrockData, setBedrockData] = useState({
    secretAccessKey: "",
    sessionToken: "",
    endpoint: "",
  });
  const [region, setRegion] = useState(defaultRegion);
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const azureNeedsDeployment = isAzure && azureData.apiType === "chat" && azureData.endpointMode === "deployment";
  const azureConfigIncomplete = isAzure && (
    !azureData.azureEndpoint.trim() || (azureNeedsDeployment && !azureData.deployment.trim())
  );
  const effectiveCredentialLabel = isAzure
    ? (azureData.authMode === "bearer" ? "Bearer / Entra Token" : (azureData.authMode === "both" ? "API Key / Shared Token" : "API Key"))
    : credentialLabel;
  const bulkPlaceholder = isCloudflareAi
    ? `name1|sk-key1|acc123456\nname2|sk-key2|def789012\nsk-key-only-auto-named`
    : BULK_PLACEHOLDER;

  const [mode, setMode] = useState("single"); // "single" | "bulk"
  const [bulkText, setBulkText] = useState("");
  const [bulkResult, setBulkResult] = useState(null); // { success, failed }
  // This modal can stay mounted while the selected provider changes. Treat a
  // stale bulk state as single mode for providers whose credentials require
  // structured metadata (Azure and Bedrock).
  const activeMode = supportsBulk ? mode : "single";

  const buildProviderSpecificData = () => {
    if (isOllamaLocal && formData.ollamaHostUrl.trim()) {
      return { baseUrl: formData.ollamaHostUrl.trim() };
    }
    if (isAzure) {
      const result = {
        apiType: azureData.apiType,
        endpointMode: azureData.endpointMode,
        authMode: azureData.authMode,
        azureEndpoint: azureData.azureEndpoint.trim(),
        apiVersion: azureData.apiVersion.trim(),
      };
      if (azureData.deployment.trim()) result.deployment = azureData.deployment.trim();
      if (azureData.organization.trim()) {
        result.organization = azureData.organization.trim();
      }
      if (formData.proxyPoolId !== NONE_PROXY_POOL_VALUE) {
        result.proxyPoolId = formData.proxyPoolId;
      }
      return result;
    }
    if (isCloudflareAi) {
      return { accountId: cloudflareData.accountId };
    }
    if (isBedrock) {
      return {
        secretAccessKey: bedrockData.secretAccessKey.trim(),
        region: region || "us-east-1",
        ...(bedrockData.sessionToken.trim() ? { sessionToken: bedrockData.sessionToken.trim() } : {}),
        ...(bedrockData.endpoint.trim() ? { endpoint: bedrockData.endpoint.trim() } : {}),
        ...(formData.proxyPoolId !== NONE_PROXY_POOL_VALUE ? { proxyPoolId: formData.proxyPoolId } : {}),
      };
    }
    if (providerRegions && region) {
      return { region };
    }
    return undefined;
  };

  const handleValidate = async () => {
    setValidating(true);
    try {
      const res = await fetch("/api/providers/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey: formData.apiKey, providerSpecificData: buildProviderSpecificData() }),
      });
      const data = await res.json();
      setValidationResult(data.valid ? "success" : "failed");
    } catch {
      setValidationResult("failed");
    } finally {
      setValidating(false);
    }
  };

  const handleSubmit = async () => {
    if (!provider) return;
    if (!isOllamaLocal && !formData.apiKey) return;
    if (!isOllamaLocal) {
      // Non-ollama providers require a name
      if (!formData.name) return;
    }
    if (isCompatible && !formData.defaultModel.trim()) return;
    if (isBedrock && !bedrockData.secretAccessKey.trim()) return;
    if (azureConfigIncomplete) return;

    setSaving(true);
    try {
      let isValid = false;
      try {
        setValidating(true);
        setValidationResult(null);
        const res = await fetch("/api/providers/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider, apiKey: formData.apiKey, providerSpecificData: buildProviderSpecificData() }),
        });
        const data = await res.json();
        isValid = !!data.valid;
        setValidationResult(isValid ? "success" : "failed");
      } catch {
        setValidationResult("failed");
      } finally {
        setValidating(false);
      }

      await onSave({
        name: formData.name || (isOllamaLocal ? "Ollama Local" : ""),
        apiKey: formData.apiKey,
        defaultModel: isCompatible ? formData.defaultModel.trim() : undefined,
        priority: formData.priority,
        proxyPoolId: formData.proxyPoolId === NONE_PROXY_POOL_VALUE ? null : formData.proxyPoolId,
        testStatus: isValid ? "active" : "unknown",
        providerSpecificData: buildProviderSpecificData()
      });
    } finally {
      setSaving(false);
    }
  };

  const handleBulkSubmit = async () => {
    if (!supportsBulk) return;
    const lines = bulkText.split("\n");
    if (!lines.length) return;
    // Plan collision-free names against existing connections so a generated
    // "Key N" never matches a saved name (which the backend would upsert /
    // overwrite instead of inserting). See bulkAdd.js for the full rationale.
    const plan = planBulkAdd(lines, existingNames, { isCloudflareAi });
    if (!plan.length) return;
    setSaving(true);
    setBulkResult(null);
    let success = 0;
    let failed = 0;
    for (const entry of plan) {
      try {
        const res = await fetch("/api/providers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider,
            apiKey: entry.apiKey,
            name: entry.name,
            priority: 1,
            testStatus: "unknown",
            ...(entry.providerSpecificData ? { providerSpecificData: entry.providerSpecificData } : {}),
          }),
        });
        if (res.ok) success++;
        else failed++;
      } catch {
        failed++;
      }
    }
    setSaving(false);
    setBulkResult({ success, failed });
    if (success > 0 && onBulkDone) onBulkDone();
  };

  if (!provider) return null;

  return (
    <Modal isOpen={isOpen} title={`Add ${providerName || provider} ${effectiveCredentialLabel}`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        {/* Azure and Bedrock require structured metadata, so key-only bulk import is unavailable. */}
        {supportsBulk && <div className="flex gap-2">
          <Button size="sm" variant={activeMode === "single" ? "primary" : "ghost"} onClick={() => { setMode("single"); setBulkResult(null); }}>Single</Button>
          <Button size="sm" variant={activeMode === "bulk" ? "primary" : "ghost"} onClick={() => { setMode("bulk"); setBulkResult(null); }}>Bulk Add</Button>
        </div>}

        {supportsBulk && activeMode === "bulk" && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-text-muted">
              {isCloudflareAi
                ? <>One key per line. Format: <code>name|apiKey|accountId</code> or just <code>apiKey</code> (auto-named by index).</>
                : <>One key per line. Format: <code>name|apiKey</code> or just <code>apiKey</code> (auto-named by index).</>
              }
            </p>
            <textarea
              className="w-full rounded border border-accent/30 bg-sidebar p-2 text-sm font-mono resize-y min-h-[140px] focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder={bulkPlaceholder}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
            />
            {bulkResult && (
              <div className={`text-sm font-medium ${bulkResult.failed > 0 ? "text-yellow-400" : "text-green-400"}`}>
                ✓ {bulkResult.success} added{bulkResult.failed > 0 ? `, ✗ ${bulkResult.failed} failed` : ""}
              </div>
            )}
            <div className="flex gap-2">
              <Button onClick={handleBulkSubmit} fullWidth disabled={saving || !bulkText.trim()}>
                {saving ? "Adding..." : "Add All Keys"}
              </Button>
              <Button onClick={onClose} variant="ghost" fullWidth>Cancel</Button>
            </div>
          </div>
        )}

        {activeMode === "single" && (<>
        <Input
          label="Name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder={isOllamaLocal ? "Ollama Local" : "Production Key"}
        />
        {isOllamaLocal && (
          <div className="flex gap-2">
            <Input
              label="Ollama Host URL"
              value={formData.ollamaHostUrl}
              onChange={(e) => setFormData({ ...formData, ollamaHostUrl: e.target.value })}
              placeholder="http://localhost:11434"
              className="flex-1"
            />
            <div className="pt-6">
              <Button onClick={handleValidate} disabled={validating || saving} variant="secondary">
                {validating ? "Checking..." : "Check"}
              </Button>
            </div>
          </div>
        )}
        {!isOllamaLocal && (
          <div className="flex gap-2">
            <Input
              label={effectiveCredentialLabel}
              type={isCookie ? "text" : "password"}
              value={formData.apiKey}
              onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
              placeholder={credentialPlaceholder}
              className="flex-1"
            />
            <div className="pt-6">
              <Button onClick={handleValidate} disabled={!formData.apiKey || (isBedrock && !bedrockData.secretAccessKey.trim()) || azureConfigIncomplete || validating || saving} variant="secondary">
                {validating ? "Checking..." : "Check"}
              </Button>
            </div>
          </div>
        )}
        {isXaiApiKey && (
          <p className="text-xs text-text-muted">
            Use a direct xAI API key from console.x.ai. This is separate from Grok Build OAuth.
          </p>
        )}
        {isCookie && authHint && (
          <p className="text-xs text-text-muted">
            {authHint}
            {website && (
              <>
                {" "}
                <a href={website} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                  Open {website.replace(/^https?:\/\//, "")}
                </a>
              </>
            )}
          </p>
        )}
        {providerRegions && (
          <Select
            label="Region"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            options={providerRegions.map((r) => ({ value: r.id, label: r.label }))}
          />
        )}
        {isCompatible && (
          <Input
            label="Default Model"
            value={formData.defaultModel}
            onChange={(e) => setFormData({ ...formData, defaultModel: e.target.value })}
            placeholder={isAnthropic ? "claude-3-5-sonnet-latest" : "gpt-4o-mini"}
          />
        )}
        {isOllamaLocal && (
          <p className="text-xs text-text-muted">
            Leave blank to use <code>http://localhost:11434</code>. For remote Ollama, enter the full host URL (e.g. <code>http://192.168.1.10:11434</code>).
          </p>
        )}
        {validationResult && (
          <Badge variant={validationResult === "success" ? "success" : "error"}>
            {validationResult === "success" ? "Valid" : "Invalid"}
          </Badge>
        )}
        {error && (
          <p className="text-xs text-red-500 break-words">{error}</p>
        )}
        {isCompatible && (
          <p className="text-xs text-text-muted">
            Enter the model ID exactly as your compatible endpoint expects it. This model will be saved as the connection default.
          </p>
        )}
        {isCloudflareAi && (
          <div className="bg-sidebar/50 p-4 rounded-lg border border-accent/20">
            <h3 className="font-semibold mb-3 text-sm">Cloudflare Workers AI</h3>
            <Input
              label="Account ID"
              value={cloudflareData.accountId}
              onChange={(e) => setCloudflareData({ ...cloudflareData, accountId: e.target.value })}
              placeholder="abc123def456..."
            />
            <p className="text-xs text-text-muted mt-2">
              Find your Account ID in the right sidebar of <a href="https://dash.cloudflare.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">dash.cloudflare.com</a>
            </p>
          </div>
        )}
        {isBedrock && (
          <div className="bg-sidebar/50 p-4 rounded-lg border border-accent/20">
            <h3 className="font-semibold mb-3 text-sm">AWS Bedrock Credentials</h3>
            <div className="flex flex-col gap-3">
              <Input
                label="AWS Secret Access Key"
                type="password"
                value={bedrockData.secretAccessKey}
                onChange={(e) => setBedrockData({ ...bedrockData, secretAccessKey: e.target.value })}
                placeholder="Required"
              />
              <Input
                label="AWS Session Token (optional)"
                type="password"
                value={bedrockData.sessionToken}
                onChange={(e) => setBedrockData({ ...bedrockData, sessionToken: e.target.value })}
                placeholder="Required only for temporary credentials"
              />
              <Input
                label="Custom Bedrock Endpoint (optional)"
                value={bedrockData.endpoint}
                onChange={(e) => setBedrockData({ ...bedrockData, endpoint: e.target.value })}
                placeholder="https://bedrock-runtime.us-east-1.amazonaws.com"
                hint="Leave blank to use the standard endpoint for the selected region."
              />
            </div>
          </div>
        )}
        {isAzure && (
          <div className="bg-sidebar/50 p-4 rounded-lg border border-accent/20">
            <h3 className="font-semibold mb-3 text-sm">Azure OpenAI Configuration</h3>
            <div className="flex flex-col gap-3">
              <Select
                label="API Type"
                value={azureData.apiType}
                onChange={(e) => {
                  const apiType = e.target.value;
                  setAzureData((current) => ({
                    ...current,
                    apiType,
                    // Prefer the current Azure resource v1 shape when a user
                    // first switches to Responses. Legacy resource mode stays
                    // selectable explicitly below.
                    ...(apiType === "responses" && current.apiType !== "responses" && current.endpointMode === "deployment"
                      ? { endpointMode: "direct" }
                      : {}),
                    ...(apiType === "responses" && current.apiType !== "responses" && current.apiVersion === "2024-10-01-preview"
                      ? { apiVersion: "v1" }
                      : {}),
                  }));
                }}
                options={[
                  { value: "chat", label: "Chat Completions" },
                  { value: "responses", label: "Responses API" },
                ]}
              />
              <Select
                label="Endpoint Mode"
                value={azureData.endpointMode}
                onChange={(e) => setAzureData({ ...azureData, endpointMode: e.target.value })}
                options={[
                  { value: "deployment", label: azureData.apiType === "responses" ? "Legacy resource Responses" : "Azure resource / deployment" },
                  { value: "direct", label: azureData.apiType === "responses" ? "Azure resource v1 (recommended)" : "Direct base URL" },
                  { value: "full", label: "Full endpoint URL" },
                ]}
              />
              <Select
                label="Auth Mode"
                value={azureData.authMode}
                onChange={(e) => setAzureData({ ...azureData, authMode: e.target.value })}
                options={[
                  { value: "api-key", label: "API key header" },
                  { value: "bearer", label: "Bearer / Entra token" },
                  { value: "both", label: "Both headers" },
                ]}
              />
              <Input
                label="Azure Endpoint"
                value={azureData.azureEndpoint}
                onChange={(e) => setAzureData({ ...azureData, azureEndpoint: e.target.value })}
                placeholder={azureData.apiType === "responses"
                  ? (azureData.endpointMode === "full"
                    ? "https://your-resource.openai.azure.com/openai/v1/responses"
                    : (azureData.endpointMode === "direct"
                      ? "https://your-resource.openai.azure.com/openai/v1"
                      : "https://your-resource.openai.azure.com"))
                  : (azureData.endpointMode === "full"
                    ? "https://host/openai/v1/chat/completions"
                    : "https://your-resource.openai.azure.com")}
                hint={azureData.apiType === "responses"
                  ? (azureData.endpointMode === "deployment"
                    ? "Legacy compatibility mode appends /openai/responses. For current Azure resources, choose Azure resource v1 instead."
                    : "Current Azure resource shape uses /openai/v1/responses; direct mode appends /responses to a base ending in /openai/v1.")
                  : "Enter the Azure resource, direct base URL, or complete endpoint selected above."}
              />
              {(azureData.endpointMode === "deployment" || azureData.apiType === "responses") && (
                <Input
                  label={azureData.apiType === "responses" ? "Deployment / model override (optional)" : "Deployment Name"}
                  value={azureData.deployment}
                  onChange={(e) => setAzureData({ ...azureData, deployment: e.target.value })}
                  placeholder="gpt-4"
                />
              )}
              <Input
                label="API Version"
                value={azureData.apiVersion}
                onChange={(e) => setAzureData({ ...azureData, apiVersion: e.target.value })}
                placeholder={azureData.apiType === "responses" && azureData.endpointMode !== "deployment" ? "v1" : "2024-10-01-preview"}
                hint={azureData.apiType === "responses" && azureData.endpointMode !== "deployment"
                  ? "Use v1 for the current Azure resource Responses endpoint."
                  : "Use the API version supported by this Azure endpoint."}
              />
              <Input
                label="Organization (optional)"
                value={azureData.organization}
                onChange={(e) => setAzureData({ ...azureData, organization: e.target.value })}
                placeholder="Only needed when your gateway requires it"
              />
            </div>
          </div>
        )}

        <Input
          label="Priority"
          type="number"
          value={formData.priority}
          onChange={(e) => setFormData({ ...formData, priority: Number.parseInt(e.target.value) || 1 })}
        />

        <Select
          label="Proxy Pool"
          value={formData.proxyPoolId}
          onChange={(e) => setFormData({ ...formData, proxyPoolId: e.target.value })}
          options={[
            { value: NONE_PROXY_POOL_VALUE, label: "None" },
            ...(proxyPools || []).map((pool) => ({ value: pool.id, label: pool.name })),
          ]}
          placeholder="None"
        />

        {(proxyPools || []).length === 0 && (
          <p className="text-xs text-text-muted">
            No active proxy pools available. Create one in Proxy Pools page first.
          </p>
        )}

        <p className="text-xs text-text-muted">
          Legacy manual proxy fields are still accepted by API for backward compatibility.
        </p>

        <div className="flex gap-2">
          <Button onClick={handleSubmit} fullWidth disabled={saving || (!isOllamaLocal && (!formData.name || !formData.apiKey)) || (isCompatible && !formData.defaultModel.trim()) || (isBedrock && !bedrockData.secretAccessKey.trim()) || azureConfigIncomplete || (isCloudflareAi && !cloudflareData.accountId)}>
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>
            Cancel
          </Button>
        </div>
        </>)}
      </div>
    </Modal>
  );
}

AddApiKeyModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  provider: PropTypes.string,
  providerName: PropTypes.string,
  isCompatible: PropTypes.bool,
  isAnthropic: PropTypes.bool,
  authType: PropTypes.string,
  authHint: PropTypes.string,
  website: PropTypes.string,
  proxyPools: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
  })),
  error: PropTypes.string,
  existingNames: PropTypes.arrayOf(PropTypes.string),
  onSave: PropTypes.func.isRequired,
  onBulkDone: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
