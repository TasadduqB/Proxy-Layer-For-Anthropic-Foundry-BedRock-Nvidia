#!/usr/bin/env node

import { getApiKeys } from "@/lib/db/index.js";

const apiKey = (await getApiKeys()).find((key) => key.isActive !== false)?.key;

async function probe(index) {
  const response = await fetch("http://127.0.0.1:8787/api/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      ...(apiKey ? { "x-api-key": apiKey } : {}),
    },
    body: JSON.stringify({
      model: "claude-opus-5",
      max_tokens: 128,
      stream: false,
      messages: [{ role: "user", content: `Parallel pool health probe ${index}: call probe with ok=true.` }],
      tools: [{
        name: "probe",
        description: "Return a successful routing health probe.",
        input_schema: {
          type: "object",
          properties: { ok: { type: "boolean" } },
          required: ["ok"],
        },
      }],
      tool_choice: { type: "tool", name: "probe" },
    }),
    signal: AbortSignal.timeout(45_000),
  });
  const payload = await response.json().catch(() => ({}));
  return {
    probe: index,
    status: response.status,
    ok: response.ok,
    stopReason: payload.stop_reason || null,
    toolUse: Array.isArray(payload.content)
      && payload.content.some((block) => block?.type === "tool_use" && block?.name === "probe"),
    error: response.ok
      ? null
      : String(payload?.error?.message || payload?.message || "unknown error").slice(0, 500),
  };
}

console.log(JSON.stringify(await Promise.all([1, 2, 3].map(probe)), null, 2));
