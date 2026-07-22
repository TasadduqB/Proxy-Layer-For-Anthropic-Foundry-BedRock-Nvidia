import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-max-full-export-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("complete database export/import", () => {
  it("round-trips usage, daily aggregates, request details, disabled models, and counters", async () => {
    await db.updateSettings({ enableObservability: true, observabilityBatchSize: 1, observabilityFlushIntervalMs: 10 });
    await db.disableModels("nvidia", ["model-disabled"]);
    await db.saveRequestUsage({
      requestId: "export-usage-1",
      provider: "nvidia",
      model: "model-a",
      tokens: { prompt_tokens: 12, completion_tokens: 4 },
      status: "ok",
    });
    await db.saveRequestDetail({
      id: "export-detail-1",
      provider: "nvidia",
      model: "model-a",
      status: "ok",
      request: { method: "POST" },
      response: { status: 200 },
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const snapshot = await db.exportDb();
    expect(snapshot.databaseFormatVersion).toBe(3);
    expect(snapshot.usageHistory).toHaveLength(1);
    expect(snapshot.usageDaily).toHaveLength(1);
    expect(snapshot.requestDetails.some((row) => row.id === "export-detail-1")).toBe(true);
    expect(snapshot.disabledModels.nvidia).toContain("model-disabled");
    expect(Array.isArray(snapshot.meta)).toBe(true);

    await db.saveRequestUsage({
      requestId: "export-usage-2",
      provider: "nvidia",
      model: "model-b",
      tokens: { prompt_tokens: 20, completion_tokens: 5 },
    });
    await db.disableModels("nvidia", ["model-after-snapshot"]);
    expect((await db.getUsageHistory({ provider: "nvidia" }))).toHaveLength(2);

    await db.importDb(snapshot);
    const history = await db.getUsageHistory({ provider: "nvidia" });
    expect(history).toHaveLength(1);
    expect(history[0].model).toBe("model-a");
    expect(await db.getDisabledByProvider("nvidia")).toEqual(["model-disabled"]);
    expect((await db.getRequestDetailById("export-detail-1"))?.id).toBe("export-detail-1");
    expect((await db.getUsageStats("24h")).totalRequests).toBe(1);
  });
});
