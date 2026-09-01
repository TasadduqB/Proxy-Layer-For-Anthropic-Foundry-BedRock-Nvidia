/**
 * Find the first combo (from an already-fetched list) that lists
 * `canonicalModel` as one of its members. Pure, dependency-free so it can be
 * unit-tested in isolation. Used to give plain (non-combo) chat requests the
 * same cross-provider resilience a combo has, without requiring the caller
 * to know every provider up front — see chat.js's `handleSingleModelChat`.
 * @param {string} canonicalModel - e.g. "tokenrouter/claude-sonnet-5"
 * @param {Array<{name: string, models: string[]}>} combos
 * @returns {{comboName: string, siblings: string[]}|null}
 */
export function findComboFallbackModels(canonicalModel, combos) {
  if (!canonicalModel) return null;
  for (const combo of combos || []) {
    const members = combo?.models;
    if (!Array.isArray(members) || members.length < 2) continue;
    if (!members.includes(canonicalModel)) continue;
    const siblings = members.filter((m) => m !== canonicalModel);
    if (siblings.length > 0) return { comboName: combo.name, siblings };
  }
  return null;
}
