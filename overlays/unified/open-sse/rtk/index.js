// RTK port: compress tool_result content in LLM request bodies
// Injected at the top of translateRequest (before any format translation)
import { RAW_CAP, MIN_COMPRESS_SIZE } from "./constants.js";
import { autoDetectFilter } from "./autodetect.js";
import { safeApply } from "./applyFilter.js";

// Tools whose output IS the artifact the model will later reproduce verbatim
// (e.g. a find-and-replace/Edit tool's old_string must byte-match the file on
// disk). Every filter here is lossy by design (collapsed blank-line runs,
// deduped "identical" lines, head/tail truncation with content dropped from
// the middle) — safe for noisy command output, but silently corrupting a file
// read means the model edits against content that no longer matches disk,
// producing "string to replace not found" errors. Never compress these.
const EXACT_CONTENT_TOOL_RE = /read|view[_-]?file|cat[_-]?file|show[_-]?file|get[_-]?file[_-]?content/i;

function isExactContentTool(name) {
  return typeof name === "string" && EXACT_CONTENT_TOOL_RE.test(name);
}

// Single pass over the conversation to resolve tool_use/tool_call ids → tool
// names, so a later tool_result/tool message can be matched back to what
// actually produced it (the result block itself never carries the name).
function buildToolNameMap(items) {
  const map = new Map();
  for (const msg of items) {
    if (!msg) continue;
    // Claude shape: assistant content blocks { type:"tool_use", id, name }
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block?.type === "tool_use" && block.id && block.name) {
          map.set(block.id, block.name);
        }
      }
    }
    // OpenAI classic shape: assistant.tool_calls[].{id, function.name}
    if (Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        if (tc?.id && tc.function?.name) map.set(tc.id, tc.function.name);
      }
    }
    // OpenAI Responses shape: top-level { type:"function_call", call_id, name }
    if (msg.type === "function_call" && msg.call_id && msg.name) {
      map.set(msg.call_id, msg.name);
    }
  }
  return map;
}

// Compress tool_result content in-place. Returns stats or null if disabled/failed.
export function compressMessages(body, enabled) {
  if (!enabled) return null;
  if (!body) return null;

  // Kiro format: conversationState.history + conversationState.currentMessage
  if (body.conversationState) {
    return compressKiroFormat(body, enabled);
  }

  // Support both OpenAI/Claude "messages" and OpenAI Responses "input"
  const items = Array.isArray(body.messages) ? body.messages
    : Array.isArray(body.input) ? body.input
    : null;
  if (!items) return null;

  const toolNameById = buildToolNameMap(items);
  const stats = { bytesBefore: 0, bytesAfter: 0, hits: [] };
  try {
    for (let i = 0; i < items.length; i++) {
      const msg = items[i];
      if (!msg) continue;

      // Shape 4: OpenAI Responses — top-level { type:"function_call_output", output: string | [{type:"input_text", text}] }
      if (msg.type === "function_call_output") {
        if (isExactContentTool(toolNameById.get(msg.call_id))) continue;
        if (typeof msg.output === "string") {
          msg.output = compressText(msg.output, stats, "openai-responses-string");
        } else if (Array.isArray(msg.output)) {
          for (let k = 0; k < msg.output.length; k++) {
            const part = msg.output[k];
            if (part && part.type === "input_text" && typeof part.text === "string") {
              part.text = compressText(part.text, stats, "openai-responses-array");
            }
          }
        }
        continue;
      }

      // Shape 1: OpenAI tool message — { role:"tool", content: "string" }
      if (msg.role === "tool" && typeof msg.content === "string") {
        if (isExactContentTool(toolNameById.get(msg.tool_call_id))) continue;
        msg.content = compressText(msg.content, stats, "openai-tool");
        continue;
      }

      if (!Array.isArray(msg.content)) continue;

      // Shape 1b: OpenAI tool message — { role:"tool", content:[{type:"text", text:"..."}] }
      if (msg.role === "tool") {
        if (isExactContentTool(toolNameById.get(msg.tool_call_id))) continue;
        for (let k = 0; k < msg.content.length; k++) {
          const part = msg.content[k];
          if (part && part.type === "text" && typeof part.text === "string") {
            part.text = compressText(part.text, stats, "openai-tool-array");
          }
        }
        continue;
      }

      // Shape 2/3: blocks array with tool_result entries
      for (let j = 0; j < msg.content.length; j++) {
        const block = msg.content[j];
        if (!block || block.type !== "tool_result") continue;
        if (block.is_error === true) continue; // preserve error traces
        if (isExactContentTool(toolNameById.get(block.tool_use_id))) continue;

        if (typeof block.content === "string") {
          // Shape 2: claude string form
          block.content = compressText(block.content, stats, "claude-string");
        } else if (Array.isArray(block.content)) {
          // Shape 3: claude array form — compress each text part
          for (let k = 0; k < block.content.length; k++) {
            const part = block.content[k];
            if (part && part.type === "text" && typeof part.text === "string") {
              part.text = compressText(part.text, stats, "claude-array");
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn("[RTK] compressMessages error:", e.message);
    return null;
  }
  return stats;
}

// Compress Kiro format: conversationState.history[].userInputMessage.userInputMessageContext.toolResults[].content[].text
function compressKiroFormat(body, enabled) {
  const stats = { bytesBefore: 0, bytesAfter: 0, hits: [] };
  try {
    const state = body.conversationState;
    const allMessages = [...(Array.isArray(state?.history) ? state.history : [])];
    if (state?.currentMessage) allMessages.push(state.currentMessage);

    const toolNameById = new Map();
    for (const msg of allMessages) {
      for (const tu of msg?.assistantResponseMessage?.toolUses || []) {
        if (tu?.toolUseId && tu.name) toolNameById.set(tu.toolUseId, tu.name);
      }
    }

    for (const msg of allMessages) {
      const toolResults = msg?.userInputMessage?.userInputMessageContext?.toolResults;
      if (!Array.isArray(toolResults)) continue;

      for (const tr of toolResults) {
        if (tr.status === "error") continue; // preserve error traces
        if (isExactContentTool(toolNameById.get(tr.toolUseId))) continue;
        if (!Array.isArray(tr.content)) continue;

        for (const part of tr.content) {
          if (part && typeof part.text === "string") {
            part.text = compressText(part.text, stats, "kiro-tool-result");
          }
        }
      }
    }
  } catch (e) {
    console.warn("[RTK] compressKiroFormat error:", e.message);
    return null;
  }
  return stats;
}

function compressText(text, stats, shape) {
  const bytesIn = text.length;
  stats.bytesBefore += bytesIn;

  if (bytesIn < MIN_COMPRESS_SIZE || bytesIn > RAW_CAP) {
    stats.bytesAfter += bytesIn;
    return text;
  }

  const fn = autoDetectFilter(text);
  if (!fn) {
    stats.bytesAfter += bytesIn;
    return text;
  }

  const out = safeApply(fn, text);

  // Safety: never return empty, never grow the input
  if (!out || out.length === 0 || out.length >= bytesIn) {
    stats.bytesAfter += bytesIn;
    return text;
  }

  stats.bytesAfter += out.length;
  stats.hits.push({ shape, filter: fn.filterName || fn.name, saved: bytesIn - out.length });
  return out;
}

// Convenience: format a log line from stats
export function formatRtkLog(stats) {
  if (!stats || !stats.hits || stats.hits.length === 0) return null;
  const saved = stats.bytesBefore - stats.bytesAfter;
  const pct = stats.bytesBefore > 0 ? ((saved / stats.bytesBefore) * 100).toFixed(1) : "0";
  const filters = Array.from(new Set(stats.hits.map(h => h.filter))).join(",");
  return `[RTK] saved ${saved}B / ${stats.bytesBefore}B (${pct}%) via [${filters}] hits=${stats.hits.length}`;
}
