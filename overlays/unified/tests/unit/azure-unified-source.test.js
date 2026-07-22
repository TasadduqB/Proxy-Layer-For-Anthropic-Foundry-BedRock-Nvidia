import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workspaceRoot = path.resolve(runtimeRoot, "../../..");

function readRuntime(relativePath) {
  return fs.readFileSync(path.join(runtimeRoot, relativePath), "utf8");
}

describe("Azure unified endpoint source contracts", () => {
  it.each([
    "src/app/(dashboard)/dashboard/providers/[id]/AddApiKeyModal.js",
    "src/shared/components/EditConnectionModal.js",
  ])("exposes explicit endpoint, API, and auth modes in %s", (relativePath) => {
    const source = readRuntime(relativePath);
    expect(source).toContain('label="API Type"');
    expect(source).toContain('label="Endpoint Mode"');
    expect(source).toContain('label="Auth Mode"');
    expect(source).toContain('{ value: "responses", label: "Responses API" }');
    expect(source).toContain('{ value: "full", label: "Full endpoint URL" }');
    expect(source).toContain('{ value: "both", label: "Both headers" }');
    expect(source).toContain('azureData.endpointMode === "deployment"');
    expect(source).toContain('Azure resource v1 (recommended)');
    expect(source).toContain('/openai/v1/responses');
    expect(source).toContain('apiVersion: "v1"');
    expect(source).toContain("Organization (optional)");
    expect(source).not.toContain('hint="Required for billing"');
  });

  it("never exposes stale key-only bulk mode for structured Azure or Bedrock credentials", () => {
    const source = readRuntime("src/app/(dashboard)/dashboard/providers/[id]/AddApiKeyModal.js");
    expect(source).toContain("const supportsBulk = !isAzure && !isBedrock");
    expect(source).toContain('const activeMode = supportsBulk ? mode : "single"');
    expect(source).toContain("if (!supportsBulk) return");
    expect(source).toContain('{supportsBulk && activeMode === "bulk" && (');
    expect(source).toContain('{activeMode === "single" && (<>');
  });

  it("uses the shared Azure probe and connection proxy in both validators", () => {
    const validate = readRuntime("src/app/api/providers/validate/route.js");
    const connectionTest = readRuntime("src/app/api/providers/[id]/test/testUtils.js");
    for (const source of [validate, connectionTest]) {
      expect(source).toContain("executeAzureProbe");
      expect(source).toContain("Invalid Azure credential or configuration");
    }
    expect(validate).toContain("resolveConnectionProxyConfig(providerSpecificData || {})");
    expect(validate).toContain("proxyOptions: effectiveProxy");
    expect(connectionTest).toContain("fetchWithConnectionProxy(url, options, effectiveProxy)");
  });

  it("normalizes and exposes only the non-secret Azure schema fields", () => {
    const createRoute = readRuntime("src/app/api/providers/route.js");
    const updateRoute = readRuntime("src/app/api/providers/[id]/route.js");
    const clientRoute = readRuntime("src/app/api/providers/client/route.js");
    expect(createRoute).toContain("normalizeAzureProviderSpecificData");
    expect(updateRoute).toContain("normalizeAzureProviderSpecificData");
    for (const field of ["apiType", "endpointMode", "authMode", "organization"]) {
      expect(clientRoute).toContain(`"${field}"`);
    }
  });

  it("migration no longer leaves Responses or direct Azure endpoints on legacy", () => {
    const migration = fs.readFileSync(path.join(workspaceRoot, "src/migration/unified-migration.js"), "utf8");
    expect(migration).not.toContain("AZURE_RESPONSES_REMAINS_LEGACY");
    expect(migration).not.toContain("AZURE_DIRECT_INFERENCE_REMAINS_LEGACY");
    expect(migration).toContain("endpointMode");
    expect(migration).toContain("authMode");
  });
});
