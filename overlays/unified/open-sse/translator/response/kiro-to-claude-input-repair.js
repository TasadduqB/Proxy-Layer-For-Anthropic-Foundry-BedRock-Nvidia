import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { kiroToClaudeResponse } from "./kiro-to-claude.js";
import { normalizeRepeatedToolInput } from "./openai-to-claude-edit-repair.js";

function repairKiroToolDeltas(results, state) {
  if (!Array.isArray(results)) return results;
  state.proxyMaxKiroToolNames ??= new Map();

  for (const item of results) {
    if (item?.type === "content_block_start" && item.content_block?.type === "tool_use") {
      state.proxyMaxKiroToolNames.set(item.index, item.content_block.name || "");
      continue;
    }
    if (item?.type !== "content_block_delta" || item.delta?.type !== "input_json_delta") continue;

    const normalized = normalizeRepeatedToolInput(item.delta.partial_json);
    if (!normalized.repaired) continue;
    item.delta.partial_json = normalized.value;
    const toolName = state.proxyMaxKiroToolNames.get(item.index) || "tool call";
    console.info(`[proxy-max] collapsed ${normalized.copies} complete argument snapshots for ${toolName}`);
  }
  return results;
}

export function kiroToClaudeWithInputRepair(chunk, state) {
  return repairKiroToolDeltas(kiroToClaudeResponse(chunk, state), state);
}

// Kiro has a direct response edge and therefore does not pass through the
// OpenAI -> Claude wrapper. Register the same conservative input repair here.
register(FORMATS.KIRO, FORMATS.CLAUDE, null, kiroToClaudeWithInputRepair);
