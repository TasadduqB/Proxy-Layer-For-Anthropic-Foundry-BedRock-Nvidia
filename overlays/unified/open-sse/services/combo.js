/**
 * Shared combo (model combo) handling with fallback support
 */

import { checkFallbackError, formatRetryAfter } from "./accountFallback.js";
import { resolveProviderAlias } from "./model.js";
import { unavailableResponse } from "../utils/error.js";
import { getCapabilitiesForModel } from "../providers/capabilities.js";
import { extractTextContent } from "../translator/formats/gemini.js";

// Hard capabilities = input modalities; missing one drops request data (e.g. image
// stripped). Must be prioritized. Soft (e.g. search) only degrades a feature.
const HARD_CAPS = new Set(["vision", "pdf", "audioInput", "videoInput"]);

// Prefixes used when flattening tool turns into plain prose for panel models.
const TOOL_CALL_PREFIX = "[Called tools: ";
const TOOL_RESULT_PREFIX = "[Tool result: ";

// Flatten tool turns into prose so panel models keep the context but can't loop
// on tools: drop the request's tools, turn tool/function results into assistant
// text, and inline assistant tool_calls names instead of the structured field.
function flattenToolHistory(messages) {
  return messages
    .filter((msg) => msg)
    .map((msg) => {
      if (msg.role === "tool" || msg.role === "function") {
        return { role: "assistant", content: `${TOOL_RESULT_PREFIX}${extractTextContent(msg.content) || String(msg.content ?? "")}]` };
      }
      if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
        const { tool_calls, ...rest } = msg;
        const names = tool_calls.map((c) => c?.function?.name || c?.name || "tool").join(", ");
        const base = extractTextContent(rest.content) || (typeof rest.content === "string" ? rest.content : "");
        return { ...rest, content: `${base}${base ? "\n" : ""}${TOOL_CALL_PREFIX}${names}]` };
      }
      if (Array.isArray(msg.content)) {
        const hasToolUse = msg.content.some((c) => c.type === "tool_use");
        const hasToolResult = msg.content.some((c) => c.type === "tool_result");
        if (hasToolUse || hasToolResult) {
          const textParts = [];
          const toolNames = [];
          const toolResults = [];
          for (const block of msg.content) {
            if (block.type === "text" && block.text) textParts.push(block.text);
            if (block.type === "tool_use") toolNames.push(block.name || "tool");
            if (block.type === "tool_result") toolResults.push(extractTextContent(block.content) || String(block.content ?? ""));
          }
          const { ...rest } = msg;
          let newContent = textParts.join("\n");
          if (toolNames.length > 0) {
            newContent = `${newContent}${newContent ? "\n" : ""}${TOOL_CALL_PREFIX}${toolNames.join(", ")}]`;
          }
          if (toolResults.length > 0) {
            newContent = `${newContent}${newContent ? "\n" : ""}${TOOL_RESULT_PREFIX}${toolResults.join("\n")}]`;
          }
          return { ...rest, content: newContent };
        }
      }
      return msg;
    });
}

// Reorder combo models by capability fit. Stable; never drops a model (fallback intact).
// Tier 0: satisfies all hard + all soft. Tier 1: all hard only. Tier 2: rest.
export function reorderByCapabilities(models, required) {
  if (!required || required.size === 0 || !Array.isArray(models) || models.length <= 1) return models;
  const hard = [...required].filter((c) => HARD_CAPS.has(c));
  const soft = [...required].filter((c) => !HARD_CAPS.has(c));

  const tierOf = (m) => {
    const slash = typeof m === "string" ? m.indexOf("/") : -1;
    const provider = slash > 0 ? resolveProviderAlias(m.slice(0, slash)) : "";
    const model = slash > 0 ? m.slice(slash + 1) : m;
    const caps = getCapabilitiesForModel(provider, model);
    if (!hard.every((c) => caps[c] === true)) return 2;
    return soft.every((c) => caps[c] === true) ? 0 : 1;
  };

  // Stable sort by tier (Array.prototype.sort is stable in modern engines).
  const reordered = models
    .map((m, i) => ({ m, i, t: tierOf(m) }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((x) => x.m);

  // Preserve referential identity when ranking does not change the order. A
  // few callers use identity to distinguish "no routing decision" from an
  // actual auto-switch, and allocating a clone here obscured that signal.
  return reordered.every((model, index) => model === models[index]) ? models : reordered;
}

/**
 * Track rotation state per combo (for round-robin strategy)
 * @type {Map<string, { index: number, consecutiveUseCount: number }>}
 */
const comboRotationState = new Map();
const comboModelCooldowns = new Map();
const comboModelSuccesses = new Map();

function positiveMs(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const DEFAULT_STREAM_TTFT_TIMEOUT_MS = positiveMs(
  process.env.COMBO_STREAM_TTFT_TIMEOUT_MS,
  15_000,
);
const LARGE_CLAUDE_STREAM_TTFT_TIMEOUT_MS = positiveMs(
  process.env.LARGE_CLAUDE_STREAM_TTFT_TIMEOUT_MS,
  45_000,
);
const LARGE_CLAUDE_REQUEST_BYTES = 256 * 1024;
const DEFAULT_MODEL_COOLDOWN_MS = positiveMs(
  process.env.COMBO_MODEL_COOLDOWN_MS,
  120_000,
);
const CLAUDE_TOOL_MAX_OUTPUT_TOKENS = positiveMs(
  process.env.CLAUDE_TOOL_MAX_OUTPUT_TOKENS,
  8_192,
);
const CLAUDE_TOOL_MAX_TEXT_CHARS = positiveMs(
  process.env.CLAUDE_TOOL_MAX_TEXT_CHARS,
  64 * 1024,
);
const CLAUDE_TOOL_MAX_STREAM_BYTES = positiveMs(
  process.env.CLAUDE_TOOL_MAX_STREAM_BYTES,
  8 * 1024 * 1024,
);

function comboModelHealthKey(comboName, model) {
  return `${comboName || "__default__"}\u0000${model}`;
}

function isClaudeManagedCombo(comboName) {
  const normalized = String(comboName || "")
    .trim()
    .toLowerCase()
    .replace(/\[(?:\d+(?:\.\d+)?[km]?|long)\]$/i, "");
  return normalized === "claude-auto" || /^claude-(?:opus|sonnet|haiku|fable)(?:-|$)/.test(normalized);
}

function coolComboModel(comboName, model, cooldownMs) {
  comboModelCooldowns.set(
    comboModelHealthKey(comboName, model),
    Date.now() + positiveMs(cooldownMs, DEFAULT_MODEL_COOLDOWN_MS),
  );
}

function markComboModelSuccess(comboName, model) {
  const key = comboModelHealthKey(comboName, model);
  comboModelCooldowns.delete(key);
  comboModelSuccesses.set(key, Date.now());
}

function withoutCooledComboModels(models, comboName, now = Date.now()) {
  const ready = [];
  const cooled = [];
  for (const model of models) {
    const key = comboModelHealthKey(comboName, model);
    const until = comboModelCooldowns.get(key) || 0;
    if (until > now) cooled.push(model);
    else {
      comboModelCooldowns.delete(key);
      ready.push(model);
    }
  }
  // Never turn a configured combo into an empty route. If every model is in
  // cooldown, retry the full list and let the normal provider fallback decide.
  return ready.length > 0 ? { models: ready, cooled } : { models, cooled: [] };
}

function preferKnownHealthyFallbacks(models, comboName) {
  if (models.length <= 2) return models;
  const [first, ...rest] = models;
  const successful = rest
    .filter((model) => comboModelSuccesses.has(comboModelHealthKey(comboName, model)))
    .sort((a, b) => (
      comboModelSuccesses.get(comboModelHealthKey(comboName, b))
      - comboModelSuccesses.get(comboModelHealthKey(comboName, a))
    ));
  if (successful.length === 0) return models;
  const successfulSet = new Set(successful);
  // The strategy/capability router owns the primary choice. A previous HTTP
  // success only improves fallback order; it must never replace the selected
  // primary because a 200 response does not prove high-quality tool behavior.
  return [first, ...successful, ...rest.filter((model) => !successfulSet.has(model))];
}

async function waitForStreamingResponse(response, timeoutMs) {
  const contentType = response?.headers?.get?.("content-type") || "";
  if (!response?.body || !contentType.toLowerCase().includes("text/event-stream")) {
    return { response };
  }

  const reader = response.body.getReader();
  const timeoutMarker = Symbol("combo-stream-ttft-timeout");
  let timer;
  try {
    const first = await Promise.race([
      reader.read(),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(timeoutMarker), timeoutMs);
      }),
    ]);

    if (first === timeoutMarker) {
      await reader.cancel("combo stream time-to-first-token timeout").catch(() => {});
      return { error: `No stream data within ${timeoutMs}ms`, status: 504 };
    }
    if (first.done) {
      return { error: "Upstream returned an empty stream", status: 502 };
    }

    const replay = new ReadableStream({
      start(controller) {
        controller.enqueue(first.value);
      },
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) controller.close();
          else controller.enqueue(next.value);
        } catch (error) {
          controller.error(error);
        }
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    });

    return {
      response: new Response(replay, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      }),
    };
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    return { error: error?.message || String(error), status: 502 };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function repeatedSuffixCount(value, windowSize) {
  if (value.length < windowSize * 4) return 0;
  const suffix = value.slice(-windowSize);
  let count = 1;
  let cursor = value.length - windowSize;
  while (cursor > 0) {
    const found = value.lastIndexOf(suffix, cursor - 1);
    if (found < 0) break;
    count += 1;
    cursor = found;
  }
  return count;
}

export function hasRunawayToolNarration(value) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (normalized.length < 1_000) return false;
  return [160, 240, 320].some((size) => repeatedSuffixCount(normalized, size) >= 4);
}

function claudeToolTerminal(openBlockIndex, outputTokens) {
  const events = [];
  if (Number.isInteger(openBlockIndex)) {
    events.push(`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: openBlockIndex })}\n\n`);
  }
  events.push(
    `event: message_delta\ndata: ${JSON.stringify({
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: outputTokens },
    })}\n\n`,
    `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
  );
  return new TextEncoder().encode(events.join(""));
}

/** Bound Claude tool streams after headers have succeeded. A 200 response is
 * not healthy when it emits repeated planning prose forever without a tool.
 */
export function guardClaudeToolStream(response, options = {}) {
  const contentType = response?.headers?.get?.("content-type") || "";
  if (!response?.body || !contentType.toLowerCase().includes("text/event-stream")) return response;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let lineBuffer = "";
  let assistantText = "";
  let sawToolUse = false;
  let terminalSeen = false;
  let openBlockIndex = null;

  const inspect = (bytes) => {
    lineBuffer += decoder.decode(bytes, { stream: true });
    const lines = lineBuffer.split("\n");
    lineBuffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const raw = trimmed.slice(5).trim();
      if (!raw || raw === "[DONE]") continue;
      try {
        const event = JSON.parse(raw);
        if (event?.type === "content_block_start") {
          if (event.content_block?.type === "tool_use") sawToolUse = true;
          else if (Number.isInteger(event.index)) openBlockIndex = event.index;
        }
        if (event?.type === "content_block_stop" && event.index === openBlockIndex) openBlockIndex = null;
        if (event?.type === "content_block_delta" && typeof event.delta?.text === "string") {
          assistantText += event.delta.text;
        }
        if (event?.choices?.[0]?.delta?.tool_calls?.length) sawToolUse = true;
        if (event?.type === "message_stop" || event?.choices?.[0]?.finish_reason) terminalSeen = true;
      } catch {
        // Preserve malformed upstream data; the normal response translator owns
        // protocol errors. The guard only observes successfully parsed events.
      }
    }
  };

  const guarded = new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          inspect(value);
          controller.enqueue(value);
          const repeated = !sawToolUse && hasRunawayToolNarration(assistantText);
          const oversized = !sawToolUse && assistantText.length >= (options.maxTextChars || CLAUDE_TOOL_MAX_TEXT_CHARS);
          if (!terminalSeen && (repeated || oversized)) {
            const reason = repeated ? "repeated planning prose" : "tool-less output limit";
            options.onRunaway?.(reason);
            await reader.cancel(`Claude tool stream stopped: ${reason}`).catch(() => {});
            controller.enqueue(claudeToolTerminal(openBlockIndex, Math.ceil(assistantText.length / 4)));
            controller.close();
            return;
          }
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  return new Response(guarded, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function joinByteChunks(chunks, totalBytes) {
  const joined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

/**
 * Buffer and validate Claude tool-use SSE before exposing it to Claude Code.
 *
 * A provider can return HTTP 200 and only reveal broken function arguments in
 * its final stream chunk. Once any part of that stream reaches Claude Code the
 * combo can no longer fall back, and the CLI reports an opaque "input JSON
 * failed to parse" error. Buffering is deliberately limited to managed Claude
 * tool requests, where correctness is more important than token-by-token UI.
 */
export async function validateClaudeToolStream(response, options = {}) {
  const contentType = response?.headers?.get?.("content-type") || "";
  if (!response?.body || !contentType.toLowerCase().includes("text/event-stream")) {
    return { response };
  }

  const maxBytes = positiveMs(options.maxBytes, CLAUDE_TOOL_MAX_STREAM_BYTES);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  const tools = new Map();
  let totalBytes = 0;
  let lineBuffer = "";

  const inspectLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const raw = trimmed.slice(5).trim();
    if (!raw || raw === "[DONE]") return;

    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      throw new Error("Malformed Claude SSE event JSON");
    }

    if (event?.type === "content_block_start" && event.content_block?.type === "tool_use") {
      tools.set(event.index, {
        name: event.content_block.name || "unknown tool",
        initialInput: event.content_block.input,
        partialJson: "",
      });
      return;
    }

    if (event?.type === "content_block_delta" && event.delta?.type === "input_json_delta") {
      const tool = tools.get(event.index);
      if (tool && typeof event.delta.partial_json === "string") {
        tool.partialJson += event.delta.partial_json;
      }
    }
  };

  const inspectBytes = (bytes, flush = false) => {
    lineBuffer += decoder.decode(bytes, { stream: !flush });
    const lines = lineBuffer.split(/\r?\n/);
    lineBuffer = lines.pop() || "";
    for (const line of lines) inspectLine(line);
    if (flush && lineBuffer) {
      inspectLine(lineBuffer);
      lineBuffer = "";
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel("Claude tool stream validation limit exceeded").catch(() => {});
        return {
          error: `Claude tool stream exceeded ${maxBytes} bytes before validation`,
          status: 502,
        };
      }
      chunks.push(value);
      inspectBytes(value);
    }
    inspectBytes(new Uint8Array(), true);

    for (const tool of tools.values()) {
      if (!tool.partialJson) {
        if (tool.initialInput && typeof tool.initialInput === "object") continue;
        throw new Error(`Missing input JSON for ${tool.name}`);
      }
      try {
        const parsed = JSON.parse(tool.partialJson);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("tool input must be an object");
        }
      } catch {
        throw new Error(`Malformed input JSON for ${tool.name}`);
      }
    }

    return {
      response: new Response(joinByteChunks(chunks, totalBytes), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      }),
    };
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    return { error: error?.message || String(error), status: 502 };
  }
}

// Trailing run of items after the last assistant/model turn = the current user
// turn. It may span several messages (e.g. text + image split across blocks),
// so we return all of them. History media (older turns) must not pin the combo
// to a vision model — those get stripped + placeholdered downstream instead.
function trailingUserItems(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return [];
  const isAssistant = (r) => r === "assistant" || r === "model";
  let i = arr.length - 1;
  while (i >= 0 && !isAssistant(arr[i]?.role)) i--;
  return arr.slice(i + 1);
}

// Detect which capabilities a request needs. Modalities (vision/pdf) are scanned
// only on the current user turn; "search" is request-wide (lives in tools).
// Returns a Set of: "vision" | "pdf" | "search".
export function detectRequiredCapabilities(body) {
  const required = new Set();
  if (!body || typeof body !== "object") return required;

  const scanBlock = (b) => {
    if (!b || typeof b !== "object") return;
    const t = b.type;
    if (t === "image_url" || t === "image" || t === "input_image") required.add("vision");
    if (t === "file" || t === "document" || t === "input_file") required.add("pdf");
    if (t === "audio" || t === "audio_url" || t === "input_audio") required.add("audioInput");
    if (t === "video" || t === "video_url" || t === "input_video") required.add("videoInput");
    // gemini parts: inlineData/fileData carry a mime
    const mime = b.inlineData?.mimeType || b.fileData?.mimeType ||
      b.inline_data?.mime_type || b.file_data?.mime_type;
    if (typeof mime === "string" && mime.startsWith("image/")) required.add("vision");
    if (typeof mime === "string" && mime.startsWith("audio/")) required.add("audioInput");
    if (typeof mime === "string" && mime.startsWith("video/")) required.add("videoInput");
    if (mime === "application/pdf") required.add("pdf");
  };

  const scanContent = (content) => {
    if (Array.isArray(content)) for (const b of content) scanBlock(b);
  };

  // Modalities: current user turn only (trailing user run across each known shape).
  for (const m of trailingUserItems(body.messages)) scanContent(m.content);      // openai / claude
  for (const it of trailingUserItems(body.input)) scanContent(it.content);       // responses
  const contents = body.contents || body.request?.contents;                      // gemini / antigravity
  for (const c of trailingUserItems(contents)) scanContent(c.parts);

  // Built-in search tools are model capabilities, unlike ordinary function
  // tools. Cover the OpenAI/Claude type spellings and Gemini grounding shape.
  const tools = Array.isArray(body.tools)
    ? body.tools
    : (Array.isArray(body.request?.tools) ? body.request.tools : []);
  for (const tool of tools) {
    const type = typeof tool?.type === "string" ? tool.type.toLowerCase() : "";
    if (
      type === "web_search" ||
      type === "web_search_preview" ||
      type.startsWith("web_search_") ||
      tool?.googleSearch ||
      tool?.google_search ||
      tool?.googleSearchRetrieval
    ) {
      required.add("search");
      break;
    }
  }

  return required;
}

function normalizeStickyLimit(stickyLimit) {
  const parsed = Number.parseInt(stickyLimit, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function rotateModelsFromIndex(models, currentIndex) {
  const rotatedModels = [...models];
  for (let i = 0; i < currentIndex; i++) {
    const moved = rotatedModels.shift();
    rotatedModels.push(moved);
  }
  return rotatedModels;
}

/**
 * Get rotated model list based on strategy
 * @param {string[]} models - Array of model strings
 * @param {string} comboName - Name of the combo
 * @param {string} strategy - "fallback" or "round-robin"
 * @param {number|string} [stickyLimit=1] - Requests per combo model before switching
 * @returns {string[]} Rotated models array
 */
export function getRotatedModels(models, comboName, strategy, stickyLimit = 1) {
  if (!models || models.length <= 1 || strategy !== "round-robin") {
    return models;
  }

  const rotationKey = comboName || "__default__";
  const normalizedStickyLimit = normalizeStickyLimit(stickyLimit);
  const existingState = comboRotationState.get(rotationKey);
  const state = typeof existingState === "number"
    ? { index: existingState, consecutiveUseCount: 0 }
    : (existingState || { index: 0, consecutiveUseCount: 0 });

  const currentIndex = state.index % models.length;
  const rotatedModels = rotateModelsFromIndex(models, currentIndex);
  const nextUseCount = state.consecutiveUseCount + 1;

  if (nextUseCount >= normalizedStickyLimit) {
    comboRotationState.set(rotationKey, {
      index: (currentIndex + 1) % models.length,
      consecutiveUseCount: 0,
    });
  } else {
    comboRotationState.set(rotationKey, {
      index: currentIndex,
      consecutiveUseCount: nextUseCount,
    });
  }

  return rotatedModels;
}

/**
 * Reset in-memory rotation state when combo/settings change
 * @param {string} [comboName] - Combo name to reset; omit to clear all
 */
export function resetComboRotation(comboName) {
  if (comboName) {
    comboRotationState.delete(comboName);
    const prefix = `${comboName}\u0000`;
    for (const key of comboModelCooldowns.keys()) {
      if (key.startsWith(prefix)) comboModelCooldowns.delete(key);
    }
    for (const key of comboModelSuccesses.keys()) {
      if (key.startsWith(prefix)) comboModelSuccesses.delete(key);
    }
  } else {
    comboRotationState.clear();
    comboModelCooldowns.clear();
    comboModelSuccesses.clear();
  }
}

/**
 * Get combo models from combos data
 * @param {string} modelStr - Model string to check
 * @param {Array|Object} combosData - Array of combos or object with combos
 * @returns {string[]|null} Array of models or null if not a combo
 */
export function getComboModelsFromData(modelStr, combosData) {
  if (typeof modelStr !== "string" || !modelStr.trim()) return null;
  const normalized = modelStr.trim();

  // Don't check if it's in provider/model format
  if (normalized.includes("/")) return null;

  // Handle both array and object formats
  const comboCandidates = Array.isArray(combosData) ? combosData : combosData?.combos;
  const combos = Array.isArray(comboCandidates) ? comboCandidates : [];

  const combo = combos.find(c => c?.name === normalized);
  if (combo && Array.isArray(combo.models) && combo.models.length > 0) {
    return combo.models;
  }
  return null;
}

/**
 * Handle combo chat with fallback
 * @param {Object} options
 * @param {Object} options.body - Request body
 * @param {string[]} options.models - Array of model strings to try
 * @param {Function} options.handleSingleModel - Function to handle single model: (body, modelStr) => Promise<Response>
 * @param {Object} options.log - Logger object
 * @param {string} [options.comboName] - Name of the combo (for round-robin tracking)
 * @param {string} [options.comboStrategy] - Strategy: "fallback" or "round-robin"
 * @param {number|string} [options.comboStickyLimit=1] - Requests per combo model before switching
 * @returns {Promise<Response>}
 */
export async function handleComboChat({ body, models, handleSingleModel, log, comboName, comboStrategy, comboStickyLimit = 1, autoSwitch = true, streamTtftTimeoutMs = DEFAULT_STREAM_TTFT_TIMEOUT_MS, modelCooldownMs = DEFAULT_MODEL_COOLDOWN_MS }) {
  // Claude Code's tool loop needs a stable primary. Selection still belongs to
  // the proxy, but rotation occurs on actual failure rather than on every Read,
  // Edit, and Update turn. Other dashboard combos retain their chosen strategy.
  const effectiveStrategy = isClaudeManagedCombo(comboName) ? "fallback" : comboStrategy;
  const claudeToolRequest = isClaudeManagedCombo(comboName) && Array.isArray(body?.tools) && body.tools.length > 0;
  const routedBody = claudeToolRequest && Number(body?.max_tokens) > CLAUDE_TOOL_MAX_OUTPUT_TOKENS
    ? { ...body, max_tokens: CLAUDE_TOOL_MAX_OUTPUT_TOKENS }
    : body;
  const requestBytes = claudeToolRequest ? JSON.stringify(routedBody).length : 0;
  const effectiveStreamTtftTimeoutMs = requestBytes >= LARGE_CLAUDE_REQUEST_BYTES
    ? Math.max(
        positiveMs(streamTtftTimeoutMs, DEFAULT_STREAM_TTFT_TIMEOUT_MS),
        LARGE_CLAUDE_STREAM_TTFT_TIMEOUT_MS,
      )
    : positiveMs(streamTtftTimeoutMs, DEFAULT_STREAM_TTFT_TIMEOUT_MS);
  let rotatedModels = getRotatedModels(models, comboName, effectiveStrategy, comboStickyLimit);

  // Auto-switch: float models that satisfy the request's required capabilities to the front.
  if (autoSwitch) {
    const required = detectRequiredCapabilities(body);
    if (required.size > 0) {
      const reordered = reorderByCapabilities(rotatedModels, required);
      if (reordered[0] !== rotatedModels[0]) {
        log.info("COMBO", `auto-switch for [${[...required].join(",")}] → ${reordered[0]}`);
      }
      rotatedModels = reordered;
    }
  }

  const health = withoutCooledComboModels(rotatedModels, comboName);
  rotatedModels = preferKnownHealthyFallbacks(health.models, comboName);
  if (health.cooled.length > 0) {
    log.info("COMBO", `Skipping ${health.cooled.length} cooling model(s): ${health.cooled.join(", ")}`);
  }

  let lastError = null;
  let earliestRetryAfter = null;
  let lastStatus = null;

  for (let i = 0; i < rotatedModels.length; i++) {
    const modelStr = rotatedModels[i];
    log.info("COMBO", `Trying model ${i + 1}/${rotatedModels.length}: ${modelStr}`);

    try {
      const result = await handleSingleModel(routedBody, modelStr);

      // Success (2xx) - return response
      if (result.ok) {
        const ready = await waitForStreamingResponse(
          result,
          effectiveStreamTtftTimeoutMs,
        );
        if (!ready.response) {
          lastError = ready.error;
          if (!lastStatus) lastStatus = ready.status;
          coolComboModel(comboName, modelStr, modelCooldownMs);
          log.warn("COMBO", `Model ${modelStr} stream not ready, trying next`, {
            status: ready.status,
            error: ready.error,
          });
          continue;
        }
        const guardedResponse = claudeToolRequest
          ? guardClaudeToolStream(ready.response, {
              onRunaway: (reason) => {
                coolComboModel(comboName, modelStr, modelCooldownMs);
                log.warn("COMBO", `Stopped runaway tool stream from ${modelStr}: ${reason}`);
              },
            })
          : ready.response;
        const validated = claudeToolRequest
          ? await validateClaudeToolStream(guardedResponse)
          : { response: guardedResponse };
        if (!validated.response) {
          lastError = validated.error;
          if (!lastStatus) lastStatus = validated.status;
          coolComboModel(comboName, modelStr, modelCooldownMs);
          log.warn("COMBO", `Model ${modelStr} emitted an invalid Claude tool stream, trying next`, {
            status: validated.status,
            error: validated.error,
          });
          continue;
        }
        markComboModelSuccess(comboName, modelStr);
        log.info("COMBO", `Model ${modelStr} succeeded`);
        return validated.response;
      }

      // Extract error info from response
      let errorText = result.statusText || "";
      let retryAfter = null;
      try {
        const errorBody = await result.clone().json();
        errorText = errorBody?.error?.message || errorBody?.error || errorBody?.message || errorText;
        retryAfter = errorBody?.retryAfter || null;
      } catch {
        // Ignore JSON parse errors
      }

      // Track earliest retryAfter across all combo models
      if (retryAfter && (!earliestRetryAfter || new Date(retryAfter) < new Date(earliestRetryAfter))) {
        earliestRetryAfter = retryAfter;
      }

      // Normalize error text to string (Worker-safe)
      if (typeof errorText !== "string") {
        try { errorText = JSON.stringify(errorText); } catch { errorText = String(errorText); }
      }

      // Check if should fallback to next model
      const { shouldFallback, cooldownMs } = checkFallbackError(result.status, errorText);

      if (!shouldFallback) {
        log.warn("COMBO", `Model ${modelStr} failed (no fallback)`, { status: result.status });
        return result;
      }

      // For transient errors (503/502/504), wait for cooldown before falling through
      // so a briefly-overloaded provider gets a chance to recover rather than being
      // skipped immediately (fixes: combo falls through on transient 503)
      if (cooldownMs && cooldownMs > 0 && cooldownMs <= 5000 &&
          (result.status === 503 || result.status === 502 || result.status === 504)) {
        log.info("COMBO", `Model ${modelStr} transient ${result.status}, waiting ${cooldownMs}ms before next`);
        await new Promise(r => setTimeout(r, cooldownMs));
      }

      // Fallback to next model
      lastError = errorText || String(result.status);
      if (!lastStatus) lastStatus = result.status;
      coolComboModel(comboName, modelStr, modelCooldownMs);
      log.warn("COMBO", `Model ${modelStr} failed, trying next`, { status: result.status });
    } catch (error) {
      // Catch unexpected exceptions to ensure fallback continues
      lastError = error.message || String(error);
      if (!lastStatus) lastStatus = 500;
      coolComboModel(comboName, modelStr, modelCooldownMs);
      log.warn("COMBO", `Model ${modelStr} threw error, trying next`, { error: lastError });
    }
  }

  // All models failed
  // Use 503 (Service Unavailable) rather than 406 (Not Acceptable) — 406 implies
  // the request itself is invalid, but here the providers are simply unavailable
  // or have no active credentials. 503 is more accurate and retryable by clients.
  const allDisabled = lastError && lastError.toLowerCase().includes("no credentials");
  const status = allDisabled ? 503 : (lastStatus || 503);
  const msg = lastError || "All combo models unavailable";

  if (earliestRetryAfter) {
    const retryHuman = formatRetryAfter(earliestRetryAfter);
    log.warn("COMBO", `All models failed | ${msg} (${retryHuman})`);
    return unavailableResponse(status, msg, earliestRetryAfter, retryHuman);
  }

  log.warn("COMBO", `All models failed | ${msg}`);
  return new Response(
    JSON.stringify({ error: { message: msg } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

/**
 * Extract assistant text from a non-stream completion across formats
 * (OpenAI chat, Claude messages, Gemini, OpenAI Responses). Returns "" if none.
 * Panel responses are already translated to the client format by chatCore, so the
 * leaf content→string step reuses the translator's own extractTextContent.
 */
function extractPanelText(json) {
  if (!json || typeof json !== "object") return "";

  // Antigravity's non-streaming client shape wraps the Gemini response.
  if (json.response && typeof json.response === "object") {
    const wrapped = extractPanelText(json.response);
    if (wrapped.trim()) return wrapped;
  }

  // OpenAI chat completion
  const choice = json.choices?.[0];
  if (choice) {
    const msg = choice.message ?? choice.delta ?? {};
    const t = extractTextContent(msg.content);
    if (t.trim()) return t;
    if (typeof choice.text === "string" && choice.text.trim()) return choice.text;
  }

  // Claude messages (text blocks share OpenAI's {type:"text"} shape)
  const claudeText = extractTextContent(json.content);
  if (claudeText.trim()) return claudeText;

  // Gemini (parts carry .text without a type discriminator)
  const parts = json.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    const t = parts.map((p) => p?.text || "").join("");
    if (t.trim()) return t;
  }

  // OpenAI Responses API
  if (Array.isArray(json.output)) {
    const t = json.output
      .flatMap((o) => (Array.isArray(o.content) ? o.content.map((c) => c?.text || "") : []))
      .join("");
    if (t.trim()) return t;
  }

  return "";
}

// Extract only incremental text from one already-translated stream event. Full
// terminal objects are deliberately handled as fallbacks by
// extractPanelStreamText so they do not duplicate previously received deltas.
function extractPanelDeltaText(json) {
  if (!json || typeof json !== "object") return "";

  const choiceDelta = json.choices?.[0]?.delta;
  if (choiceDelta) {
    const text = extractTextContent(choiceDelta.content);
    if (text) return text;
    if (typeof choiceDelta.text === "string") return choiceDelta.text;
  }

  // Anthropic Messages streaming.
  if (json.type === "content_block_delta" && typeof json.delta?.text === "string") {
    return json.delta.text;
  }

  // OpenAI Responses streaming.
  if (json.type === "response.output_text.delta" && typeof json.delta === "string") {
    return json.delta;
  }

  // Gemini / Antigravity streaming chunks are candidate parts. The wrapper is
  // used by Antigravity while native Gemini emits candidates at the root.
  const gemini = json.response && typeof json.response === "object" ? json.response : json;
  const parts = gemini.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    const text = parts.map((part) => part?.text || "").join("");
    if (text) return text;
  }

  return "";
}

function parsePanelStreamPayloads(raw) {
  const payloads = [];
  const ndjsonPayloads = [];
  let eventData = [];
  let sawSse = false;

  const flushEvent = () => {
    if (eventData.length === 0) return;
    const payload = eventData.join("\n").trim();
    eventData = [];
    if (payload && payload !== "[DONE]") payloads.push(payload);
  };

  for (const line of String(raw || "").split(/\r?\n/)) {
    if (line.startsWith("data:")) {
      sawSse = true;
      eventData.push(line.slice(5).trimStart());
      continue;
    }
    if (line.trim() === "") {
      flushEvent();
      continue;
    }
    // Some compatible endpoints call a response a stream but emit NDJSON.
    if (eventData.length === 0 && /^[\[{]/.test(line.trim())) {
      ndjsonPayloads.push(line.trim());
    }
  }
  flushEvent();

  if (sawSse) return payloads;

  // A provider may ignore stream=true and return one ordinary JSON body. Try
  // the complete payload before falling back to one-object-per-line NDJSON.
  const complete = String(raw || "").trim();
  if (!complete) return [];
  try {
    JSON.parse(complete);
    return [complete];
  } catch {
    return ndjsonPayloads;
  }
}

function extractPanelStreamText(raw) {
  const deltas = [];
  let fullText = "";

  for (const payload of parsePanelStreamPayloads(raw)) {
    let event;
    try {
      event = JSON.parse(payload);
    } catch {
      continue;
    }

    const delta = extractPanelDeltaText(event);
    if (delta) {
      deltas.push(delta);
      continue;
    }

    // Keep the latest complete response only as a fallback. Responses streams
    // commonly include both output_text.delta events and response.completed.
    const complete = extractPanelText(event);
    if (complete) fullText = complete;
  }

  return deltas.length > 0 ? deltas.join("") : fullText;
}

async function extractPanelResponseText(response, streamExpected) {
  const clone = response.clone();
  const contentType = response.headers?.get?.("content-type") || "";
  if (streamExpected || contentType.includes("text/event-stream") || contentType.includes("ndjson")) {
    if (typeof clone.text === "function") {
      return extractPanelStreamText(await clone.text());
    }
  }
  const json = await clone.json();
  return extractPanelText(json);
}

function cancelUnusedResponse(response) {
  try {
    const pending = response?.body?.cancel?.();
    if (pending?.catch) pending.catch(() => {});
  } catch {
    // Best-effort release of a buffered stream branch.
  }
}

/**
 * Append a synthesized user turn to whichever message array the request format uses.
 * Preserves the original conversation + system prompt so the judge has full context.
 */
function appendUserTurn(body, text) {
  const next = { ...body };
  if (Array.isArray(body.messages)) {
    next.messages = [...body.messages, { role: "user", content: text }];
  } else if (Array.isArray(body.input)) {
    next.input = [...body.input, { role: "user", content: text }];
  } else if (Array.isArray(body.contents)) {
    next.contents = [...body.contents, { role: "user", parts: [{ text }] }];
  } else {
    next.messages = [{ role: "user", content: text }];
  }
  return next;
}

/**
 * Build the judge directive. Per OpenRouter's Fusion design, the judge does NOT
 * merge — it analyzes (consensus / contradictions / partial coverage / unique
 * insights / blind spots) then writes one answer grounded in that analysis.
 * ~3/4 of fusion's quality lift comes from this synthesis step.
 *
 * Sources are anonymized ("Source N") so the judge weighs substance, not the
 * reputation of a model brand.
 */
function buildJudgePrompt(answers) {
  const panel = answers
    .map((a, i) => `[Source ${i + 1}]\n${a.text}`)
    .join("\n\n");

  return [
    `You are the JUDGE in a model-fusion panel. ${answers.length} expert models independently answered the user's most recent request. Their responses are below, anonymized by source.`,
    "",
    "Do NOT mention that multiple models were used, and do NOT refer to the sources. Produce ONE authoritative final answer addressed directly to the user.",
    "",
    "First, internally analyze the panel along these dimensions: consensus (points most sources agree on — treat as higher-confidence), contradictions (where they disagree — resolve with your own judgment), partial coverage, unique insights only one source surfaced, and blind spots every source missed. Then write the best possible final answer grounded in that analysis — more complete and correct than any single response, with no filler.",
    "",
    "=== PANEL RESPONSES ===",
    panel,
    "=== END PANEL RESPONSES ===",
    "",
    "Now write the final answer to the user's original request.",
  ].join("\n");
}

// Fusion tuning. Overridable per-combo via settings.comboStrategies[name].
const FUSION_DEFAULTS = {
  minPanel: 2,             // answers needed before stragglers get a grace window
  stragglerGraceMs: 8000,  // wait this long for laggards once quorum is reached
  panelHardTimeoutMs: 90000, // absolute cap so one hung model can't stall forever
};

// Resolve a Response (or {__error}) within ms; the loser keeps running but is ignored.
function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ __timeout: true }), ms);
    Promise.resolve(promise)
      .then((v) => { clearTimeout(t); resolve(v); })
      .catch((e) => { clearTimeout(t); resolve({ __error: e }); });
  });
}

/**
 * Collect panel responses with quorum-grace: as soon as `minPanel` calls succeed,
 * start a short grace timer for the rest, then proceed with whatever arrived. This
 * caps the straggler penalty (the slowest model otherwise dominates wall time) while
 * still preferring a full panel when everyone is fast. Bounded by a hard timeout.
 * Returns a sparse array aligned to `calls` (undefined = not yet / dropped).
 */
function collectPanel(calls, { minPanel, stragglerGraceMs, panelHardTimeoutMs }) {
  return new Promise((resolve) => {
    const out = new Array(calls.length);
    let settled = 0;
    let ok = 0;
    let finished = false;
    let graceTimer = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(hardTimer);
      if (graceTimer) clearTimeout(graceTimer);
      resolve(out);
    };
    const hardTimer = setTimeout(finish, panelHardTimeoutMs);
    calls.forEach((p, i) => {
      Promise.resolve(p)
        .then((v) => { out[i] = v; })
        .catch((e) => { out[i] = { __error: e }; })
        .finally(() => {
          settled++;
          if (out[i] && out[i].ok) ok++;
          if (settled === calls.length) return finish();
          if (ok >= minPanel && !graceTimer) graceTimer = setTimeout(finish, stragglerGraceMs);
        });
    });
  });
}

/**
 * Handle a fusion combo: fan the prompt out to every panel model in parallel,
 * then a judge model synthesizes one final answer from all panel responses.
 *
 * Panel calls are forced non-streaming with tools stripped (the judge needs
 * complete prose to synthesize). The judge call keeps the client's original
 * stream flag + tools, so streaming and downstream tool use still work.
 *
 * Speed: quorum-grace collection caps the straggler penalty. Quality: the judge
 * runs the consensus/contradiction/blind-spot analysis before writing.
 *
 * Degrades gracefully: 0 panel answers -> 503, exactly 1 -> return it directly.
 *
 * @param {Object} options
 * @param {Object} options.body - Request body (client format)
 * @param {string[]} options.models - Panel model strings
 * @param {Function} options.handleSingleModel - (body, modelStr) => Promise<Response>
 * @param {Object} options.log - Logger
 * @param {string} [options.comboName] - Combo name (logging)
 * @param {string} [options.judgeModel] - Judge model; falls back to panel[0]
 * @param {Object} [options.tuning] - Override FUSION_DEFAULTS (minPanel, grace, timeout)
 * @returns {Promise<Response>}
 */
export async function handleFusionChat({ body, models, handleSingleModel, log, comboName, judgeModel, tuning }) {
  const panel = Array.isArray(models) ? models.filter(Boolean) : [];
  if (panel.length === 0) {
    return new Response(
      JSON.stringify({ error: { message: "Fusion combo has no models" } }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // A single-model fusion has nothing to fuse — just answer directly.
  if (panel.length === 1) {
    return handleSingleModel(body, panel[0]);
  }

  const cfg = { ...FUSION_DEFAULTS, ...(tuning || {}) };
  const minPanel = Math.min(Math.max(2, cfg.minPanel), panel.length);
  const judge = judgeModel && judgeModel.trim() ? judgeModel.trim() : panel[0];
  log.info("FUSION", `Combo "${comboName}" | panel=${panel.length} [${panel.join(", ")}] | judge=${judge} | quorum=${minPanel}`);

  // 1. Fan out to the panel in parallel with tools stripped (we want prose).
  // Preserve an explicitly streaming client's wire format, and native Gemini's
  // implicit streaming contract, so a sole survivor can be returned untouched
  // without a duplicate/billable request. A cloned branch is buffered below for
  // judge text extraction.
  const { tools, tool_choice, ...rest } = body;
  const panelStreaming = body.stream === true ||
    Array.isArray(body.contents) ||
    Array.isArray(body.request?.contents);
  const panelBody = { ...rest, stream: panelStreaming };

  // Flatten tool turns to prose so panel models keep context without emitting tool_calls.
  if (Array.isArray(panelBody.messages)) {
    panelBody.messages = flattenToolHistory(panelBody.messages);
  } else if (Array.isArray(panelBody.input)) {
    panelBody.input = flattenToolHistory(panelBody.input);
  }

  const t0 = Date.now();
  const calls = panel.map((m) => withTimeout(handleSingleModel(panelBody, m, true), cfg.panelHardTimeoutMs));
  const settled = await collectPanel(calls, { ...cfg, minPanel });
  log.info("FUSION", `fan-out collected in ${Date.now() - t0}ms`);

  // 2. Collect successful answers.
  const parsedPanel = await Promise.all(settled.map((res) => {
    if (!res || res.__timeout || res.__error || !res.ok) return Promise.resolve(null);
    return withTimeout(extractPanelResponseText(res, panelStreaming), cfg.panelHardTimeoutMs);
  }));

  const answers = [];
  for (let i = 0; i < settled.length; i++) {
    const res = settled[i];
    const model = panel[i];
    if (!res) { log.warn("FUSION", `Panel ${model} dropped (straggler/timeout)`); continue; }
    if (res.__timeout) { log.warn("FUSION", `Panel ${model} timed out`); continue; }
    if (res.__error) { log.warn("FUSION", `Panel ${model} threw`, { error: res.__error?.message || String(res.__error) }); continue; }
    if (!res.ok) { log.warn("FUSION", `Panel ${model} failed`, { status: res.status }); continue; }
    try {
      const parsed = parsedPanel[i];
      if (parsed?.__timeout) {
        cancelUnusedResponse(res);
        log.warn("FUSION", `Panel ${model} body timed out`);
        continue;
      }
      if (parsed?.__error) throw parsed.__error;
      const text = typeof parsed === "string" ? parsed : "";
      if (text) {
        // Keep the original response intact. We parse a clone above so the
        // sole-survivor path can return the already-successful response without
        // consuming its body or issuing a second billable model request.
        answers.push({ model, text, response: res });
        log.info("FUSION", `Panel ${model} ok (${text.length} chars)`);
      } else {
        log.warn("FUSION", `Panel ${model} returned empty content`);
      }
    } catch (e) {
      log.warn("FUSION", `Panel ${model} unparseable`, { error: e.message || String(e) });
    }
  }

  // 3. Degrade gracefully when the panel is too thin to fuse.
  if (answers.length === 0) {
    for (const res of settled) cancelUnusedResponse(res);
    log.warn("FUSION", "All panel models failed");
    return new Response(
      JSON.stringify({ error: { message: "All fusion panel models failed" } }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }
  if (answers.length === 1) {
    for (const res of settled) {
      if (res !== answers[0].response) cancelUnusedResponse(res);
    }
    log.info("FUSION", `Only ${answers[0].model} succeeded — answering directly (no fusion)`);
    return answers[0].response;
  }

  // 4. Judge analyzes + writes one final answer (streams to client if requested).
  for (const res of settled) cancelUnusedResponse(res);
  const judgeBody = appendUserTurn(body, buildJudgePrompt(answers));
  log.info("FUSION", `Judging ${answers.length} answers with ${judge}`);
  return handleSingleModel(judgeBody, judge);
}
