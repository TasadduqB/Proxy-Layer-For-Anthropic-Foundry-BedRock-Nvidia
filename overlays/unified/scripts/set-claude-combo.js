#!/usr/bin/env node

import { getComboByName, setModelAlias } from "@/lib/db/index.js";

const comboName = String(process.argv[2] || "").trim();
if (!comboName) {
  console.error("Usage: set-claude-combo.js <combo-name>");
  process.exitCode = 2;
} else {
  const combo = await getComboByName(comboName);
  if (!combo || !Array.isArray(combo.models) || combo.models.length === 0) {
    console.error(`Combo ${comboName} does not exist or has no models`);
    process.exitCode = 2;
  } else {
    const aliases = [
      "default", "sonnet", "opus", "opusplan", "haiku", "fable",
      "claude-fable-5",
      "claude-opus-5", "claude-opus-4-8", "claude-opus-4-7",
      "claude-opus-4-6", "claude-opus-4-6-thinking",
      "claude-opus-4-5", "claude-opus-4-5-20251101",
      "claude-opus-4-1", "claude-opus-4-1-20250805",
      "claude-sonnet-5", "claude-sonnet-4-6", "claude-sonnet-4-5",
      "claude-sonnet-4-5-20250929",
      "claude-haiku-4-5", "claude-haiku-4-5-20251001",
    ];
    await Promise.all(aliases.map((alias) => setModelAlias(alias, comboName)));
    console.log(JSON.stringify({
      combo: comboName,
      modelCount: combo.models.length,
      aliasesUpdated: aliases.length,
    }, null, 2));
  }
}
