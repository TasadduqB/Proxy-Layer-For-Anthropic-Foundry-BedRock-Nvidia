import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;

async function setupDb() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-max-model-routing-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();

  const { createCombo, createProviderNode, setModelAlias } = await import("@/models/index.js");
  const { getModelInfo, getComboModels } = await import("@/sse/services/model.js");

  return {
    createCombo,
    createProviderNode,
    setModelAlias,
    getModelInfo,
    getComboModels,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

describe("model routing", () => {
  let cleanup = () => {};

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    cleanup();
    cleanup = () => {};
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("keeps built-in provider aliases ahead of compatible node prefixes", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;

    await ctx.createProviderNode({
      id: "openai-compatible-chat-test",
      type: "openai-compatible",
      name: "Compatible CF Collision",
      prefix: "cf",
      apiType: "chat",
      baseUrl: "https://compatible.test/v1",
    });

    await expect(ctx.getModelInfo("cf/@cf/black-forest-labs/flux-2-klein-9b"))
      .resolves.toEqual({
        provider: "cloudflare-ai",
        model: "@cf/black-forest-labs/flux-2-klein-9b",
      });
  });

  it("still routes non-reserved compatible node prefixes", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;

    await ctx.createProviderNode({
      id: "openai-compatible-chat-test",
      type: "openai-compatible",
      name: "Compatible OCT",
      prefix: "oct",
      apiType: "chat",
      baseUrl: "https://compatible.test/v1",
    });

    await expect(ctx.getModelInfo("oct/gpt-image-1"))
      .resolves.toEqual({
        provider: "openai-compatible-chat-test",
        model: "gpt-image-1",
      });
  });

  it("routes user model aliases through compatible node prefixes", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;

    await ctx.createProviderNode({
      id: "anthropic-compatible-alias-test",
      type: "anthropic-compatible",
      name: "Compatible Alias Target",
      prefix: "acme",
      baseUrl: "https://compatible.test/v1/messages",
    });
    await ctx.setModelAlias("fast-claude", "acme/claude-sonnet-4-6");

    await expect(ctx.getModelInfo("fast-claude")).resolves.toEqual({
      provider: "anthropic-compatible-alias-test",
      model: "claude-sonnet-4-6",
    });
  });

  it("routes Claude context-window model variants through a server combo", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;

    const models = ["nvidia/deepseek-ai/deepseek-v4-pro", "nvidia/minimaxai/minimax-m3"];
    await ctx.createCombo({ name: "claude-auto", models });
    await ctx.setModelAlias("claude-opus-4-8", "claude-auto");

    await expect(ctx.getComboModels("claude-opus-4-8[1m]")).resolves.toEqual(models);
  });

  it("normalizes Claude context-window suffixes before resolving direct aliases", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;

    await ctx.setModelAlias("claude-opus-4-8", "nvidia/deepseek-ai/deepseek-v4-pro");

    await expect(ctx.getModelInfo("claude-opus-4-8[1m]")).resolves.toEqual({
      provider: "nvidia",
      model: "deepseek-ai/deepseek-v4-pro",
    });
  });

  it("rejects non-string and empty provider/model inputs deterministically", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;

    await expect(ctx.getModelInfo(42)).resolves.toEqual({ provider: null, model: null });
    await expect(ctx.getModelInfo("openai/")).resolves.toEqual({ provider: null, model: null });
    await expect(ctx.getComboModels({ model: "combo" })).resolves.toBeNull();
  });

  it("rejects a malformed persisted combo model list", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;

    await ctx.createCombo({ name: "broken", models: "openai/gpt-5" });

    await expect(ctx.getComboModels("broken")).resolves.toBeNull();
  });
});
