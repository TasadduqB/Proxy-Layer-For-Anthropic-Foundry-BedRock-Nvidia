#!/usr/bin/env node

import { getProviderConnections } from "@/lib/db/index.js";

const requested = process.argv.slice(2);
const models = requested.length > 0 ? requested : [
  "deepseek-ai/deepseek-v4-flash-0731",
  "nvidia/nemotron-3.5-lightning-30b-a3b",
  "nvidia/nemotron-3-nano-30b-a3b",
  "stepfun-ai/step-3.7-flash",
  "mistralai/mistral-large",
  "meta/llama-3.3-70b-instruct",
  "openai/gpt-oss-120b",
];
const connections = (await getProviderConnections()).filter((connection) => (
  connection.provider === "nvidia" && connection.isActive !== false && connection.apiKey
));
if (connections.length === 0) throw new Error("No active NVIDIA connection");
const connection = connections[0];

async function probe(model) {
  const startedAt = Date.now();
  try {
    const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${connection.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Call the probe function with ok=true." }],
        max_tokens: 128,
        temperature: 0,
        stream: false,
        tools: [{
          type: "function",
          function: {
            name: "probe",
            description: "Return a successful health probe.",
            parameters: {
              type: "object",
              properties: { ok: { type: "boolean" } },
              required: ["ok"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "probe" } },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await response.json().catch(async () => ({ message: await response.text() }));
    const message = payload?.choices?.[0]?.message;
    return {
      model,
      status: response.status,
      ok: response.ok,
      toolUse: Array.isArray(message?.tool_calls) && message.tool_calls.length > 0,
      finishReason: payload?.choices?.[0]?.finish_reason || null,
      error: response.ok
        ? null
        : String(payload?.error?.message || payload?.detail || payload?.title || payload?.message || "unknown error")
          .replace(/\s+/g, " ")
          .slice(0, 300),
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      model,
      status: 502,
      ok: false,
      toolUse: false,
      finishReason: null,
      error: String(error?.message || error).slice(0, 300),
      latencyMs: Date.now() - startedAt,
    };
  }
}

const results = [];
for (const model of models) results.push(await probe(model));
console.log(JSON.stringify({ connection: connection.name || connection.id, results }, null, 2));
