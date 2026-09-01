#!/usr/bin/env node

import { quarantineRoutingTarget } from "@/lib/db/index.js";
import { resolveProviderAlias } from "open-sse/services/model.js";

const [modelStr, requestedScope = "model", statusText = "503", ...reasonParts] = process.argv.slice(2);
const scope = requestedScope === "provider" ? "provider" : "model";
const slash = String(modelStr || "").indexOf("/");
if (slash <= 0) {
  console.error("Usage: quarantine-route.js provider/model [model|provider] [status] [reason]");
  process.exitCode = 2;
} else {
  const provider = resolveProviderAlias(modelStr.slice(0, slash));
  const status = Number.parseInt(statusText, 10) || null;
  const reason = reasonParts.join(" ").trim()
    || "Manually quarantined after a confirmed upstream routing failure";
  const result = await quarantineRoutingTarget({
    provider,
    modelStr,
    scope,
    status,
    reason,
  });
  console.log(JSON.stringify(result, null, 2));
}
