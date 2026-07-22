import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-max-idempotency-"));
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

describe("usage request identity", () => {
  it("counts identical concurrent events without an explicit identity", async () => {
    const event = {
      provider: "nvidia",
      model: "same-model",
      timestamp: "2026-07-21T00:00:00.000Z",
      tokens: { prompt_tokens: 10, completion_tokens: 2 },
    };
    await Promise.all(Array.from({ length: 25 }, () => db.saveRequestUsage({ ...event })));
    const history = await db.getUsageHistory({ provider: "nvidia" });
    expect(history).toHaveLength(25);
  });

  it("deduplicates retries carrying the same explicit request id", async () => {
    const event = {
      requestId: "request-stable-1",
      provider: "azure",
      model: "gpt-test",
      tokens: { prompt_tokens: 7, completion_tokens: 3 },
    };
    await Promise.all(Array.from({ length: 10 }, () => db.saveRequestUsage({ ...event })));
    const history = await db.getUsageHistory({ provider: "azure" });
    expect(history).toHaveLength(1);
  });
});
