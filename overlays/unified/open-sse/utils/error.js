import { ERROR_TYPES, DEFAULT_ERROR_MESSAGES } from "../config/errorConfig.js";
import { extractQuotaResetAtMs } from "./quotaLimits.js";

export function buildErrorBody(statusCode, message) {
  const errorInfo = ERROR_TYPES[statusCode]
    || (statusCode >= 500
      ? { type: "server_error", code: "internal_server_error" }
      : { type: "invalid_request_error", code: "" });

  return {
    error: {
      message: message || DEFAULT_ERROR_MESSAGES[statusCode] || "An error occurred",
      type: errorInfo.type,
      code: errorInfo.code,
    },
  };
}

export function errorResponse(statusCode, message, resetsAtMs = null) {
  const body = buildErrorBody(statusCode, message);
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };
  const resetTimestamp = Number(resetsAtMs);
  if (Number.isFinite(resetTimestamp) && resetTimestamp > Date.now()) {
    body.retryAfter = new Date(resetTimestamp).toISOString();
    headers["Retry-After"] = String(
      Math.max(Math.ceil((resetTimestamp - Date.now()) / 1000), 1),
    );
  }
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers,
  });
}

export async function writeStreamError(writer, statusCode, message) {
  const errorBody = buildErrorBody(statusCode, message);
  const encoder = new TextEncoder();
  await writer.write(encoder.encode(`data: ${JSON.stringify(errorBody)}\n\n`));
}

export async function parseUpstreamError(response, executor = null) {
  let bodyText = "";
  try {
    bodyText = await response.text();
  } catch {
    bodyText = "";
  }

  let payload = null;
  try {
    payload = JSON.parse(bodyText);
  } catch {}
  const headerResetAtMs = extractQuotaResetAtMs(response, payload);

  if (executor && typeof executor.parseError === "function") {
    try {
      const parsed = executor.parseError(response, bodyText);
      if (parsed && typeof parsed === "object") {
        const msg = parsed.message
          || DEFAULT_ERROR_MESSAGES[response.status]
          || `Upstream error: ${response.status}`;
        return {
          statusCode: parsed.status || response.status,
          message: msg,
          resetsAtMs: parsed.resetsAtMs || headerResetAtMs || undefined,
        };
      }
    } catch {}
  }

  const message = payload
    ? (payload.error?.message || payload.message || payload.error || bodyText)
    : bodyText;
  const messageStr = typeof message === "string" ? message : JSON.stringify(message);
  const finalMessage = messageStr
    || DEFAULT_ERROR_MESSAGES[response.status]
    || `Upstream error: ${response.status}`;

  return {
    statusCode: response.status,
    message: finalMessage,
    resetsAtMs: headerResetAtMs || undefined,
  };
}

export function createErrorResult(statusCode, message, resetsAtMs) {
  return {
    success: false,
    status: statusCode,
    error: message,
    resetsAtMs,
    // A combo consumes only this Response. Preserve the upstream reset so
    // anonymous providers such as OpenCode are not retried on a generic
    // two-minute cooldown after reporting a much longer quota window.
    response: errorResponse(statusCode, message, resetsAtMs),
  };
}

export function unavailableResponse(statusCode, message, retryAfter, retryAfterHuman) {
  const retryAfterSec = Math.max(
    Math.ceil((new Date(retryAfter).getTime() - Date.now()) / 1000),
    1,
  );
  const msg = `${message} (${retryAfterHuman})`;
  return new Response(
    JSON.stringify({
      error: { message: msg },
      retryAfter,
    }),
    {
      status: statusCode,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSec),
      },
    },
  );
}

export function formatProviderError(error, provider, model, statusCode) {
  const code = statusCode || error.code || "FETCH_FAILED";
  const message = error.message || "Unknown error";
  const causeCode = error.cause?.code;
  const causeMsg = error.cause?.message;
  const causeStr = causeCode || causeMsg
    ? ` (cause: ${[causeCode, causeMsg].filter(Boolean).join(": ")})`
    : "";
  return `[${code}]: ${message}${causeStr}`;
}
