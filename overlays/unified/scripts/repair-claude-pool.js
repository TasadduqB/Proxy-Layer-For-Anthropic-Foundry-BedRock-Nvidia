#!/usr/bin/env node

import {
  disableModels,
  enableModels,
  getComboByName,
  getProviderConnections,
  updateProviderConnection,
  updateCombo,
} from "@/lib/db/index.js";

const comboName = String(process.argv[2] || "A").trim();
const verifiedRoutes = [
  // Independently billed Azure fallback; keep provider diversity ahead of the
  // three NVIDIA models so one NVIDIA quota domain cannot exhaust the pool.
  "azure/gpt-5.4",
  "nvidia/nvidia/nemotron-3.5-lightning-30b-a3b",
  "nvidia/minimaxai/minimax-m3",
  "nvidia/z-ai/glm-5.2",
];
const retiredOrBrokenModels = [
  "deepseek-ai/deepseek-v4-flash",
  "deepseek-ai/deepseek-v4-pro",
  "minimaxai/minimax-m2.7",
  "moonshotai/kimi-k2.6",
  "nvidia/nemotron-3-ultra-550b-a55b",
  "openai/gpt-oss-120b",
];

const combo = await getComboByName(comboName);
if (!combo) throw new Error(`Combo ${comboName} does not exist`);

await disableModels("nvidia", retiredOrBrokenModels);
await enableModels("nvidia", verifiedRoutes
  .filter((route) => route.startsWith("nvidia/"))
  .map((route) => route.slice("nvidia/".length)));
const updated = await updateCombo(combo.id, { models: verifiedRoutes });
const activeNvidiaConnections = (await getProviderConnections()).filter((connection) => (
  connection.provider === "nvidia" && connection.isActive !== false
));
await Promise.all(activeNvidiaConnections.map((connection) => updateProviderConnection(connection.id, {
  testStatus: "active",
  lastError: null,
  lastErrorAt: null,
  errorCode: null,
})));

console.log(JSON.stringify({
  combo: updated.name,
  strategy: "round-robin",
  models: updated.models,
  removedBrokenModels: retiredOrBrokenModels.length,
  restoredConnections: activeNvidiaConnections.length,
}, null, 2));
