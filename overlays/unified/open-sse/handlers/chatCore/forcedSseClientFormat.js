import { FORMATS } from "../../translator/formats.js";
import { translateNonStreamingResponse } from "./nonStreamingHandler.js";

/**
 * Providers such as Azure Responses force an upstream SSE stream even when the
 * client requested JSON. The shared SSE collector produces an OpenAI Chat
 * completion; convert that intermediate object back to Anthropic Messages for
 * Claude clients before it leaves chatCore.
 */
export async function restoreForcedSseClientFormat(result, sourceFormat) {
  if (sourceFormat !== FORMATS.CLAUDE || !result?.response) return result;

  let responseBody;
  try {
    responseBody = await result.response.clone().json();
  } catch {
    return result;
  }
  if (responseBody?.type === "message") {
    return result;
  }
  let translated;
  if (responseBody?.object === "response" && Array.isArray(responseBody.output)) {
    const content = [];
    for (const item of responseBody.output) {
      if (item?.type === "reasoning") {
        const thinking = (item.summary || [])
          .map((entry) => entry?.text || "")
          .filter(Boolean)
          .join("\n");
        if (thinking) content.push({ type: "thinking", thinking });
      } else if (item?.type === "message") {
        for (const block of item.content || []) {
          if (typeof block?.text === "string" && block.text) {
            content.push({ type: "text", text: block.text });
          }
        }
      } else if (item?.type === "function_call") {
        let input = {};
        try {
          input = typeof item.arguments === "string"
            ? JSON.parse(item.arguments)
            : (item.arguments || {});
        } catch {
          input = {};
        }
        content.push({
          type: "tool_use",
          id: item.call_id || item.id || `toolu_${Date.now()}_${content.length}`,
          name: item.name || "",
          input,
        });
      }
    }
    const usage = responseBody.usage || {};
    translated = {
      id: responseBody.id || `msg_${Date.now()}`,
      type: "message",
      role: "assistant",
      model: responseBody.model || "unknown",
      content: content.length > 0 ? content : [{ type: "text", text: "" }],
      stop_reason: content.some((block) => block.type === "tool_use") ? "tool_use" : "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: usage.input_tokens || 0,
        output_tokens: usage.output_tokens || 0,
      },
    };
  } else if (Array.isArray(responseBody?.choices)) {
    translated = translateNonStreamingResponse(
      responseBody,
      FORMATS.OPENAI,
      FORMATS.CLAUDE,
    );
  } else {
    return result;
  }
  const headers = new Headers(result.response.headers);
  headers.set("Content-Type", "application/json");
  headers.delete("Content-Length");
  return {
    ...result,
    response: new Response(JSON.stringify(translated), {
      status: result.response.status,
      statusText: result.response.statusText,
      headers,
    }),
  };
}
