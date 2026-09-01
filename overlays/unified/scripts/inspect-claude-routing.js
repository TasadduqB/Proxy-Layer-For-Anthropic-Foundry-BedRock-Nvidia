#!/usr/bin/env node

import {
  getCombos,
  getDisabledModels,
  getModelAliases,
  getProviderConnections,
} from "@/lib/db/index.js";
import { getComboModels } from "@/sse/services/model.js";

const requestedModels = process.argv.slice(2);
const claudeModels = requestedModels.length > 0 ? requestedModels : [
  "default",
  "sonnet",
  "claude-sonnet-5",
  "opus",
  "opusplan",
  "claude-opus-4-8",
  "claude-opus-5",
  "haiku",
  "claude-haiku-4-5-20251001",
  "fable",
  "claude-fable-5",
];

const [aliases, combos, disabledModels, connections] = await Promise.all([
  getModelAliases(),
  getCombos(),
  getDisabledModels(),
  getProviderConnections(),
]);
const resolved = {};
for (const model of claudeModels) resolved[model] = await getComboModels(model);

console.log(JSON.stringify({
  aliases: Object.fromEntries(
    Object.entries(aliases).filter(([name]) => claudeModels.includes(name)),
  ),
  combos: combos.map(({ id, name, kind, models }) => ({ id, name, kind, models })),
  disabledModels,
  connections: connections.map((connection) => ({
    id: connection.id,
    provider: connection.provider,
    name: connection.name || connection.displayName || connection.email || null,
    isActive: connection.isActive,
    testStatus: connection.testStatus || null,
    lastError: connection.lastError || null,
    automaticallyDisabledAt: connection.automaticallyDisabledAt || null,
  })),
  resolved,
}, null, 2));
