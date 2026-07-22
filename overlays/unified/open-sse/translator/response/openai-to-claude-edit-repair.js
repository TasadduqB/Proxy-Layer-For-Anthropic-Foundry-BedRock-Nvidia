import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { openaiToClaudeResponse } from "./openai-to-claude.js";
import { repairEditToolInput } from "../../utils/editToolArgs.js";

function parseAdjacentJsonValues(value) {
  const text = String(value || "").trim();
  const values = [];
  let offset = 0;

  while (offset < text.length) {
    while (/\s/.test(text[offset] || "")) offset += 1;
    if (offset >= text.length || (text[offset] !== "{" && text[offset] !== "[")) return null;

    const start = offset;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let foundEnd = false;

    for (; offset < text.length; offset += 1) {
      const char = text[offset];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
      } else if (char === "{" || char === "[") {
        depth += 1;
      } else if (char === "}" || char === "]") {
        depth -= 1;
        if (depth === 0) {
          const segment = text.slice(start, offset + 1);
          try { values.push(JSON.parse(segment)); } catch { return null; }
          offset += 1;
          foundEnd = true;
          break;
        }
        if (depth < 0) return null;
      }
    }

    if (!foundEnd || inString || depth !== 0) return null;
  }

  return values;
}

// Some OpenAI-compatible providers stream the complete argument object on
// every chunk instead of sending deltas. The base translator buffers those
// chunks, which can produce `{"x":1}{"x":1,"y":2}` and make Claude Code reject
// an otherwise valid tool call. Each independently valid object is a snapshot,
// so the final object is the provider's most complete view of the arguments.
// Arrays and other malformed/ambiguous input remain untouched.
export function normalizeRepeatedToolInput(value) {
  const text = String(value || "");
  try {
    JSON.parse(text);
    return { value: text, repaired: false, copies: 1 };
  } catch {}

  const adjacent = parseAdjacentJsonValues(text);
  if (!adjacent || adjacent.length < 2) return { value: text, repaired: false, copies: 0 };
  if (!adjacent.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
    return { value: text, repaired: false, copies: adjacent.length };
  }
  const normalized = adjacent.map((item) => JSON.stringify(item));
  return { value: normalized.at(-1), repaired: true, copies: adjacent.length };
}

function repairToolDeltas(results, state) {
  if (!Array.isArray(results)) return results;
  state.proxyMaxToolNames ??= new Map();

  for (const item of results) {
    if (item?.type === "content_block_start" && item.content_block?.type === "tool_use") {
      state.proxyMaxToolNames.set(item.index, item.content_block.name || "");
      continue;
    }
    if (item?.type !== "content_block_delta" || item.delta?.type !== "input_json_delta") continue;

    const toolName = state.proxyMaxToolNames.get(item.index) || "";
    const normalized = normalizeRepeatedToolInput(item.delta.partial_json);
    if (normalized.repaired) {
      item.delta.partial_json = normalized.value;
      console.info(`[proxy-max] collapsed ${normalized.copies} complete argument snapshots for ${toolName || "tool call"}`);
    }
    try {
      const parsed = JSON.parse(item.delta.partial_json);
      const repaired = repairEditToolInput(toolName, parsed);
      if (!repaired.repaired) continue;
      item.delta.partial_json = JSON.stringify(repaired.input);
      const filePath = repaired.input.file_path || repaired.input.filePath || repaired.input.path || "";
      console.info(`[proxy-max] restored exact whitespace for ${toolName} in ${filePath.split(/[\\/]/).pop() || "target file"}`);
    } catch {
      // The base translator owns malformed-JSON handling. This wrapper only
      // performs a conservative semantic repair after successful parsing.
    }
  }
  return results;
}

export function openaiToClaudeWithEditRepair(chunk, state) {
  return repairToolDeltas(openaiToClaudeResponse(chunk, state), state);
}

// Loaded after the base translator so this registration replaces only the
// OpenAI -> Claude response edge and delegates all other behavior unchanged.
register(FORMATS.OPENAI, FORMATS.CLAUDE, null, openaiToClaudeWithEditRepair);
