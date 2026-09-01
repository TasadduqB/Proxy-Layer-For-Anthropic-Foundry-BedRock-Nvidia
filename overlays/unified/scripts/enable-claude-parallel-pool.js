#!/usr/bin/env node

import { getModelAliases, getSettings, updateSettings } from "@/lib/db/index.js";

const aliases = await getModelAliases();
const settings = await getSettings();
const standardClaudeAliases = [
  "default", "sonnet", "opus", "opusplan", "haiku", "fable",
  "claude-auto",
];
const claudeAliases = [...new Set([
  ...standardClaudeAliases,
  ...Object.keys(aliases).filter((name) => /^claude-(?:opus|sonnet|haiku|fable)(?:-|$)/i.test(name)),
])];
const comboStrategies = { ...(settings.comboStrategies || {}) };

for (const alias of claudeAliases) {
  comboStrategies[alias] = {
    ...(comboStrategies[alias] || {}),
    fallbackStrategy: "round-robin",
  };
}

await updateSettings({
  comboStrategy: "round-robin",
  comboStickyRoundRobinLimit: 1,
  comboStrategies,
});

console.log(JSON.stringify({
  comboStrategy: "round-robin",
  comboStickyRoundRobinLimit: 1,
  claudeAliasesConfigured: claudeAliases.length,
}, null, 2));
