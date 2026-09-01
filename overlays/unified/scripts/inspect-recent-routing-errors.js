#!/usr/bin/env node

import { getRequestDetails } from "@/lib/db/index.js";

function compactError(value) {
  if (value == null) return null;
  const candidate = value?.error ?? value?.message ?? value;
  const text = typeof candidate === "string" ? candidate : JSON.stringify(candidate);
  return String(text || "").replace(/\s+/g, " ").slice(0, 500) || null;
}

const count = Math.min(Math.max(Number.parseInt(process.argv[2], 10) || 40, 1), 200);
const { details } = await getRequestDetails({ status: "error", pageSize: count });

console.log(JSON.stringify(details.map((detail) => ({
  timestamp: detail.timestamp,
  provider: detail.provider,
  model: detail.model,
  connectionId: detail.connectionId,
  status: detail.status,
  providerError: compactError(detail.providerResponse),
  clientError: compactError(detail.response),
  latencyMs: detail.latency?.total ?? detail.latency?.totalMs ?? null,
})), null, 2));
