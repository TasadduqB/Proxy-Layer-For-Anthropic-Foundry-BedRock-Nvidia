import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { ROLE, CLAUDE_BLOCK, MODEL_FALLBACK } from "../schema/index.js";
import { fromOpenAIFinish } from "../concerns/finishReason.js";
import { extractReasoningText } from "../concerns/reasoning.js";

// Legacy "proxy_" prefix used by older request translators. Response strips it
// defensively so tool names from such turns resolve back (e.g. proxy_Read → Read
// for arg sanitization). Current request translator emits no prefix ("") — strip
// is then a no-op. Kept intentionally; do NOT couple to request's empty prefix.
const CLAUDE_OAUTH_TOOL_PREFIX = "proxy_";

// Sanitize tool call arguments to fix bad params from non-Anthropic models
function sanitizeToolArgs(toolName, argsJson) {
  try {
    const args = JSON.parse(argsJson);
    const name = toolName.startsWith(CLAUDE_OAUTH_TOOL_PREFIX)
      ? toolName.slice(CLAUDE_OAUTH_TOOL_PREFIX.length)
      : toolName;
    if (name === "Read") sanitizeReadArgs(args);
    return JSON.stringify(args);
  } catch {
    return argsJson;
  }
}

function sanitizeReadArgs(args) {
  if (typeof args.limit === "string" && /^\d+$/.test(args.limit)) args.limit = Number(args.limit);
  if (typeof args.offset === "string" && /^-?\d+$/.test(args.offset)) args.offset = Number(args.offset);

  if (typeof args.limit === "number") {
    if (args.limit > 2000) args.limit = 2000;
    if (args.limit < 1) delete args.limit;
  }
  if (typeof args.offset === "number" && args.offset < 0) args.offset = 0;

  if ("pages" in args && !isValidPdfPagesArg(args.file_path, args.pages)) {
    delete args.pages;
  }
}

function isValidPdfPagesArg(filePath, pages) {
  return typeof filePath === "string" &&
    filePath.toLowerCase().endsWith(".pdf") &&
    typeof pages === "string" &&
    /^\d+(?:-\d+)?$/.test(pages);
}

// Helper: stop thinking block if started
function stopThinkingBlock(state, results) {
  if (!state.thinkingBlockStarted) return;
  results.push({
    type: "content_block_stop",
    index: state.thinkingBlockIndex
  });
  state.thinkingBlockStarted = false;
}

// Helper: stop text block if started
function stopTextBlock(state, results) {
  if (!state.textBlockStarted || state.textBlockClosed) return;
  state.textBlockClosed = true;
  results.push({
    type: "content_block_stop",
    index: state.textBlockIndex
  });
  state.textBlockStarted = false;
}

function normalizedToolName(name) {
  const value = String(name || "");
  return value.startsWith(CLAUDE_OAUTH_TOOL_PREFIX)
    ? value.slice(CLAUDE_OAUTH_TOOL_PREFIX.length)
    : value;
}

function syntheticToolId(state, index) {
  const messagePart = String(state.messageId || "message").replace(/[^a-zA-Z0-9_-]/g, "_");
  return `toolu_proxymax_${messagePart}_${index}`;
}

function startToolBlock(state, results, toolInfo) {
  if (Number.isInteger(toolInfo.blockIndex) || !toolInfo.name) return false;
  stopThinkingBlock(state, results);
  stopTextBlock(state, results);
  toolInfo.blockIndex = state.nextBlockIndex++;
  results.push({
    type: "content_block_start",
    index: toolInfo.blockIndex,
    content_block: {
      type: CLAUDE_BLOCK.TOOL_USE,
      id: toolInfo.id,
      name: normalizedToolName(toolInfo.name),
      input: {}
    }
  });
  return true;
}

function findToolInfoById(state, id) {
  if (!id) return null;
  for (const info of state.toolCalls.values()) {
    if (info?.id === id) return info;
  }
  return null;
}

function selectToolArgBuffer(state, toolInfo) {
  const candidates = [...(toolInfo.sourceIndexes || [])]
    .map((index) => state.toolArgBuffers?.get(index) || "")
    .filter(Boolean);
  if (candidates.length <= 1) return candidates[0] || "";

  // Prefer a complete JSON candidate. Providers occasionally repeat the same
  // tool call under another index; concatenating those copies produces invalid
  // JSON and makes Claude execute or reject a duplicated call.
  const complete = candidates.find((candidate) => {
    try {
      JSON.parse(candidate);
      return true;
    } catch {
      return false;
    }
  });
  return complete || candidates.sort((a, b) => b.length - a.length)[0];
}

// Convert OpenAI stream chunk to Claude format
export function openaiToClaudeResponse(chunk, state) {
  if (!chunk || !chunk.choices?.[0]) return null;

  const results = [];
  const choice = chunk.choices[0];
  const delta = choice.delta;

  // Track usage from OpenAI chunk if available
  if (chunk.usage && typeof chunk.usage === "object") {
    const promptTokens = typeof chunk.usage.prompt_tokens === "number" ? chunk.usage.prompt_tokens : 0;
    const outputTokens = typeof chunk.usage.completion_tokens === "number" ? chunk.usage.completion_tokens : 0;

    // Extract cache tokens from prompt_tokens_details
    const cachedTokens = chunk.usage.prompt_tokens_details?.cached_tokens;
    const cacheCreationTokens = chunk.usage.prompt_tokens_details?.cache_write_tokens
      ?? chunk.usage.prompt_tokens_details?.cache_creation_tokens;
    const cacheReadTokens = typeof cachedTokens === "number" ? cachedTokens : 0;
    const cacheCreateTokens = typeof cacheCreationTokens === "number" ? cacheCreationTokens : 0;

    // input_tokens = prompt_tokens - cached_tokens - cache_creation_tokens
    // Because OpenAI's prompt_tokens includes all prompt-side tokens
    const inputTokens = promptTokens - cacheReadTokens - cacheCreateTokens;

    state.usage = {
      input_tokens: inputTokens,
      output_tokens: outputTokens
    };

    // Add cache_read_input_tokens if present
    if (cacheReadTokens > 0) {
      state.usage.cache_read_input_tokens = cacheReadTokens;
    }

    // Add cache_creation_input_tokens if present
    if (cacheCreateTokens > 0) {
      state.usage.cache_creation_input_tokens = cacheCreateTokens;
    }

    // Note: completion_tokens_details.reasoning_tokens is already included in output_tokens
    // No need to add separately as Claude expects total output_tokens
  }

  // First chunk - ALWAYS send message_start first
  if (!state.messageStartSent) {
    state.messageStartSent = true;
    state.messageId = chunk.id?.replace("chatcmpl-", "") || `msg_${Date.now()}`;
    if (!state.messageId || state.messageId === "chat" || state.messageId.length < 8) {
      state.messageId = chunk.extend_fields?.requestId ||
        chunk.extend_fields?.traceId ||
        `msg_${Date.now()}`;
    }
    state.model = chunk.model || MODEL_FALLBACK;
    state.nextBlockIndex = 0;
    results.push({
      type: "message_start",
      message: {
        id: state.messageId,
        type: "message",
        role: ROLE.ASSISTANT,
        model: state.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 }
      }
    });
  }

  // Handle reasoning (thinking) across vendor shapes - GLM/DeepSeek/Qwen/MiniMax/etc.
  const reasoningContent = extractReasoningText(delta);
  if (reasoningContent) {
    stopTextBlock(state, results);

    if (!state.thinkingBlockStarted) {
      state.thinkingBlockIndex = state.nextBlockIndex++;
      state.thinkingBlockStarted = true;
      results.push({
        type: "content_block_start",
        index: state.thinkingBlockIndex,
        content_block: { type: CLAUDE_BLOCK.THINKING, thinking: "" }
      });
    }

    results.push({
      type: "content_block_delta",
      index: state.thinkingBlockIndex,
      delta: { type: "thinking_delta", thinking: reasoningContent }
    });
  }

  // Handle regular content
  if (delta?.content) {
    stopThinkingBlock(state, results);

    if (!state.textBlockStarted) {
      state.textBlockIndex = state.nextBlockIndex++;
      state.textBlockStarted = true;
      state.textBlockClosed = false;
      results.push({
        type: "content_block_start",
        index: state.textBlockIndex,
        content_block: { type: CLAUDE_BLOCK.TEXT, text: "" }
      });
    }

    results.push({
      type: "content_block_delta",
      index: state.textBlockIndex,
      delta: { type: "text_delta", text: delta.content }
    });
  }

  // Tool calls
  if (delta?.tool_calls) {
    for (const tc of delta.tool_calls) {
      const idx = tc.index ?? 0;

      // OpenAI-compatible providers do not all fragment tool calls the same
      // way. Some send id, name, and arguments in separate chunks; others omit
      // the id entirely. Preserve every fragment, but do not expose a Claude
      // tool block until its required name is known.
      let toolInfo = state.toolCalls.get(idx);
      if (!toolInfo) {
        toolInfo = findToolInfoById(state, tc.id);
        if (!toolInfo) {
          toolInfo = {
            id: tc.id || syntheticToolId(state, idx),
            name: tc.function?.name || "",
            blockIndex: null,
            sourceIndexes: new Set(),
          };
        }
        state.toolCalls.set(idx, toolInfo);
      }
      if (!toolInfo.sourceIndexes) toolInfo.sourceIndexes = new Set();
      toolInfo.sourceIndexes.add(idx);
      if (tc.id) toolInfo.id = tc.id;
      if (tc.function?.name) toolInfo.name = tc.function.name;
      startToolBlock(state, results, toolInfo);

      if (tc.function?.arguments) {
        // Buffer args instead of streaming — sanitize at finish to fix bad params.
        if (!state.toolArgBuffers) state.toolArgBuffers = new Map();
        state.toolArgBuffers.set(idx, (state.toolArgBuffers.get(idx) || "") + tc.function.arguments);
      }
    }
  }

  // Finish
  if (choice.finish_reason) {
    stopThinkingBlock(state, results);
    stopTextBlock(state, results);

    let emittedToolCalls = 0;
    const finishedToolInfos = new Set();
    for (const [, toolInfo] of state.toolCalls) {
      if (finishedToolInfos.has(toolInfo)) continue;
      finishedToolInfos.add(toolInfo);
      startToolBlock(state, results, toolInfo);
      if (!Number.isInteger(toolInfo.blockIndex)) continue;
      emittedToolCalls += 1;
      // Emit buffered + sanitized args as single delta before stop
      const buffered = selectToolArgBuffer(state, toolInfo);
      if (buffered) {
        const sanitized = sanitizeToolArgs(toolInfo.name, buffered);
        results.push({
          type: "content_block_delta",
          index: toolInfo.blockIndex,
          delta: { type: "input_json_delta", partial_json: sanitized }
        });
      }
      results.push({
        type: "content_block_stop",
        index: toolInfo.blockIndex
      });
    }

    // Mark finish for later usage injection in stream.js
    // A few OpenAI-compatible providers incorrectly finish a response with
    // `stop` after streaming tool calls. Anthropic clients key their tool loop
    // off stop_reason=tool_use, so derive the terminal reason from the content
    // we actually emitted instead of trusting that inconsistent marker.
    state.finishReason = emittedToolCalls > 0 ? "tool_calls" : choice.finish_reason;

    // Use tracked usage (will be estimated in stream.js if not valid)
    const finalUsage = state.usage || { input_tokens: 0, output_tokens: 0 };
    results.push({
      type: "message_delta",
      delta: { stop_reason: convertFinishReason(state.finishReason) },
      usage: finalUsage
    });
    results.push({ type: "message_stop" });
  }

  return results.length > 0 ? results : null;
}

const convertFinishReason = (reason) => fromOpenAIFinish(reason, "claude");

// Register
register(FORMATS.OPENAI, FORMATS.CLAUDE, null, openaiToClaudeResponse);
