/**
 * OpenAI to Cursor Request Translator
 * Converts OpenAI messages to Cursor ask/agent format.
 *
 * Cursor AgentService accepts OpenAI-style tool calls/results once they are
 * encoded as MCP definitions and conversation history by the executor. Keep
 * those roles and identifiers intact here so a tool round trip stays lossless.
 */
import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { ROLE, OPENAI_BLOCK, CLAUDE_BLOCK } from "../schema/index.js";
import { DEFAULT_MIN_TOKENS } from "../../config/runtimeConfig.js";

function extractContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(part => {
        if (!part || typeof part !== "object") return false;
        return part.type === OPENAI_BLOCK.TEXT && typeof part.text === "string";
      })
      .map(part => part.text || "")
      .join("");
  }
  return "";
}

const CURSOR_MEDIA_TYPES = new Set([
  OPENAI_BLOCK.IMAGE_URL,
  OPENAI_BLOCK.IMAGE,
  OPENAI_BLOCK.INPUT_AUDIO,
  OPENAI_BLOCK.AUDIO_URL,
  OPENAI_BLOCK.FILE,
]);

function cloneContentBlock(block) {
  if (!block || typeof block !== "object") return null;
  if (block.type === OPENAI_BLOCK.IMAGE_URL && block.image_url) {
    return {
      ...block,
      image_url: typeof block.image_url === "object"
        ? { ...block.image_url }
        : block.image_url,
    };
  }
  if (block.type === OPENAI_BLOCK.IMAGE && block.source) {
    return { ...block, source: { ...block.source } };
  }
  if (CURSOR_MEDIA_TYPES.has(block.type)) return { ...block };
  return null;
}

function cursorContent(parts) {
  const kept = parts.filter((part) =>
    typeof part === "string" ? part.length > 0 : Boolean(part)
  );
  if (!kept.some((part) => typeof part === "object")) return kept.join("\n");
  return kept.map((part) =>
    typeof part === "string" ? { type: OPENAI_BLOCK.TEXT, text: part } : part
  );
}

function sanitizeToolResultText(text) {
  // Strip non-printable control chars that can produce backend request errors
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function escapeXml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildToolResultBlock(toolName, toolCallId, resultText) {
  const cleanResult = sanitizeToolResultText(resultText || "");
  return [
    "<tool_result>",
    `<tool_name>${escapeXml(toolName || "tool")}</tool_name>`,
    `<tool_call_id>${escapeXml(toolCallId || "")}</tool_call_id>`,
    `<result>${escapeXml(cleanResult)}</result>`,
    "</tool_result>"
  ].join("\n");
}

function normalizeToolCallId(id) {
  return typeof id === "string" ? id.split("\n")[0] : "";
}

function convertMessages(messages) {
  const result = [];

  // Build a map of tool_call_id -> tool name from assistant tool calls
  const toolCallMetaMap = new Map();
  const rememberToolMeta = (toolCallId, toolName) => {
    if (!toolCallId) return;
    const name = toolName || "tool";
    toolCallMetaMap.set(toolCallId, { name });
    const normalized = normalizeToolCallId(toolCallId);
    if (normalized && normalized !== toolCallId) {
      toolCallMetaMap.set(normalized, { name });
    }
  };

  for (const msg of messages) {
    if (msg.role === ROLE.ASSISTANT && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        rememberToolMeta(tc.id || "", tc.function?.name || "tool");
      }
    }
    if (msg.role === ROLE.ASSISTANT && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part?.type !== CLAUDE_BLOCK.TOOL_USE) continue;
        rememberToolMeta(part.id || "", part.name || "tool");
      }
    }
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === ROLE.SYSTEM || msg.role === ROLE.DEVELOPER) {
      result.push({
        role: msg.role,
        content: extractContent(msg.content)
      });
      continue;
    }

    if (msg.role === ROLE.TOOL) {
      const toolContent = sanitizeToolResultText(extractContent(msg.content));
      const toolCallId = msg.tool_call_id || "";
      const toolMeta = toolCallMetaMap.get(toolCallId) || {};
      const toolName = msg.name || toolMeta.name || "tool";
      result.push({
        role: ROLE.TOOL,
        content: toolContent,
        tool_call_id: toolCallId,
        name: toolName,
      });
      continue;
    }

    if (msg.role === ROLE.USER || msg.role === ROLE.ASSISTANT) {
      if (msg.role === ROLE.USER && Array.isArray(msg.content)) {
        const contentParts = [];
        for (const block of msg.content) {
          if (!block || typeof block !== "object") continue;
          if (block.type === CLAUDE_BLOCK.TEXT) {
            if (typeof block.text === "string") {
              contentParts.push(block.text || "");
            }
            continue;
          }
          if (block.type === CLAUDE_BLOCK.TOOL_RESULT) {
            const toolCallId = block.tool_use_id || "";
            const toolMeta =
              toolCallMetaMap.get(toolCallId) ||
              toolCallMetaMap.get(normalizeToolCallId(toolCallId));
            const toolName = toolMeta?.name || "tool";
            const toolContent = extractContent(block.content);
            contentParts.push(buildToolResultBlock(toolName, toolCallId, toolContent));
            continue;
          }
          const media = cloneContentBlock(block);
          if (media) contentParts.push(media);
        }
        const content = cursorContent(contentParts);
        if (typeof content === "string" ? content : content.length > 0) {
          result.push({ role: ROLE.USER, content });
        }
        continue;
      }

      const content = extractContent(msg.content);
      const preservedContent = Array.isArray(msg.content)
        ? cursorContent(msg.content.flatMap((block) => {
            if (block?.type === OPENAI_BLOCK.TEXT && typeof block.text === "string") {
              return [block.text];
            }
            const media = cloneContentBlock(block);
            return media ? [media] : [];
          }))
        : content;

      if (msg.role === ROLE.ASSISTANT && msg.tool_calls && msg.tool_calls.length > 0) {
        const assistantMsg = { role: ROLE.ASSISTANT, content: preservedContent || "" };
        assistantMsg.tool_calls = msg.tool_calls.map(tc => {
          const { index, ...rest } = tc || {};
          return rest;
        });
        result.push(assistantMsg);
      } else if (msg.role === ROLE.ASSISTANT && Array.isArray(msg.content)) {
        const extractedToolCalls = msg.content
          .filter(b => b?.type === CLAUDE_BLOCK.TOOL_USE)
          .map(b => ({
            id: b.id || "",
            type: OPENAI_BLOCK.FUNCTION,
            function: {
              name: b.name || "tool",
              arguments: JSON.stringify(b.input || {})
            }
          }))
          .filter(tc => tc.id);

        if (extractedToolCalls.length > 0) {
          result.push({
            role: ROLE.ASSISTANT,
            content: preservedContent || "",
            tool_calls: extractedToolCalls
          });
        } else if (typeof preservedContent === "string" ? preservedContent : preservedContent.length > 0) {
          result.push({ role: ROLE.ASSISTANT, content: preservedContent });
        }
      } else {
        if (typeof preservedContent === "string" ? preservedContent : preservedContent.length > 0) {
          result.push({ role: msg.role, content: preservedContent });
        }
      }
    }
  }

  return result;
}

export function openaiToCursorRequest(model, body, stream, credentials) {
  const messages = convertMessages(body.messages || []);

  // Strip fields irrelevant to Cursor (OpenAI/Anthropic-specific)
  const { user, metadata, tool_choice, stream_options, system, ...rest } = body;

  return {
    ...rest,
    messages,
    max_tokens: body.max_tokens ?? body.max_completion_tokens ?? DEFAULT_MIN_TOKENS
  };
}

register(FORMATS.OPENAI, FORMATS.CURSOR, openaiToCursorRequest, null);
