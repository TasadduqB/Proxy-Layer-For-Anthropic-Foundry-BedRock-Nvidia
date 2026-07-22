import { describe, it, expect, beforeEach } from "vitest";

import {
  getComboModelsFromData,
  getRotatedModels,
  handleComboChat,
  resetComboRotation,
} from "../../open-sse/services/combo.js";

describe("combo round-robin routing", () => {
  beforeEach(() => {
    resetComboRotation();
  });

  it("keeps existing one-request round-robin behavior by default", () => {
    const models = ["provider/model-a", "provider/model-b"];

    const firstChoices = Array.from({ length: 4 }, () => (
      getRotatedModels(models, "code-xhigh", "round-robin")[0]
    ));

    expect(firstChoices).toEqual([
      "provider/model-a",
      "provider/model-b",
      "provider/model-a",
      "provider/model-b",
    ]);
  });

  it("sticks to each combo model for the configured number of requests", () => {
    const models = ["provider/model-a", "provider/model-b"];

    const firstChoices = Array.from({ length: 6 }, () => (
      getRotatedModels(models, "code-xhigh", "round-robin", 2)[0]
    ));

    expect(firstChoices).toEqual([
      "provider/model-a",
      "provider/model-a",
      "provider/model-b",
      "provider/model-b",
      "provider/model-a",
      "provider/model-a",
    ]);
  });

  it("tracks sticky rotation independently per combo", () => {
    const models = ["provider/model-a", "provider/model-b"];

    expect(getRotatedModels(models, "code-high", "round-robin", 2)[0]).toBe("provider/model-a");
    expect(getRotatedModels(models, "code-xhigh", "round-robin", 2)[0]).toBe("provider/model-a");
    expect(getRotatedModels(models, "code-high", "round-robin", 2)[0]).toBe("provider/model-a");
    expect(getRotatedModels(models, "code-high", "round-robin", 2)[0]).toBe("provider/model-b");
    expect(getRotatedModels(models, "code-xhigh", "round-robin", 2)[0]).toBe("provider/model-a");
  });

  it("does not rotate fallback combos", () => {
    const models = ["provider/model-a", "provider/model-b"];

    expect(getRotatedModels(models, "code-xhigh", "fallback", 2)).toEqual(models);
    expect(getRotatedModels(models, "code-xhigh", "fallback", 2)).toEqual(models);
  });
});

describe("combo model lookup", () => {
  const combos = [{ name: "balanced", models: ["openai/gpt-5", "claude/sonnet"] }];

  it("normalizes a combo name without mutating its configured model list", () => {
    expect(getComboModelsFromData("  balanced  ", combos)).toBe(combos[0].models);
  });

  it.each([undefined, null, 42, {}, "", "   "])(
    "rejects malformed combo input %p without throwing",
    (input) => {
      expect(getComboModelsFromData(input, combos)).toBeNull();
    }
  );

  it("rejects provider/model inputs and malformed combo entries", () => {
    expect(getComboModelsFromData("openai/gpt-5", combos)).toBeNull();
    expect(getComboModelsFromData("balanced", [null, {}, ...combos])).toBe(combos[0].models);
    expect(getComboModelsFromData("balanced", { combos: {} })).toBeNull();
    expect(getComboModelsFromData("balanced", [{ name: "balanced", models: "openai/gpt-5" }])).toBeNull();
  });
});

describe("combo streaming readiness", () => {
  beforeEach(() => {
    resetComboRotation();
  });

  it("falls through when a successful streaming response produces no first chunk", async () => {
    const attempts = [];
    const log = { info() {}, warn() {} };
    const response = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["nvidia/hanging", "nvidia/ready"],
      comboName: "claude-auto-test",
      comboStrategy: "fallback",
      streamTtftTimeoutMs: 20,
      modelCooldownMs: 1_000,
      log,
      handleSingleModel: async (_body, model) => {
        attempts.push(model);
        if (model === "nvidia/hanging") {
          return new Response(new ReadableStream({ start() {} }), {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("data: ready\n\n"));
            controller.close();
          },
        }), {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      },
    });

    expect(attempts).toEqual(["nvidia/hanging", "nvidia/ready"]);
    expect(response.ok).toBe(true);
    await expect(response.text()).resolves.toContain("data: ready");
  });

  it("does not let a prior HTTP success replace the next round-robin primary", async () => {
    const attempts = [];
    const models = ["nvidia/model-a", "nvidia/model-b", "nvidia/model-c"];
    const options = {
      body: { messages: [{ role: "user", content: "hi" }] },
      models,
      comboName: "generic-health-order",
      comboStrategy: "round-robin",
      log: { info() {}, warn() {} },
      handleSingleModel: async (_body, model) => {
        attempts.push(model);
        return new Response("ok", { status: 200 });
      },
    };

    await handleComboChat(options);
    await handleComboChat(options);

    expect(attempts).toEqual(["nvidia/model-a", "nvidia/model-b"]);
  });

  it("keeps Claude aliases on the ordered primary until a real failure", async () => {
    const attempts = [];
    const options = {
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["nvidia/tool-primary", "nvidia/tool-fallback"],
      comboName: "claude-opus-4-8[1m]",
      comboStrategy: "round-robin",
      log: { info() {}, warn() {} },
      handleSingleModel: async (_body, model) => {
        attempts.push(model);
        return new Response("ok", { status: 200 });
      },
    };

    await handleComboChat(options);
    await handleComboChat(options);

    expect(attempts).toEqual(["nvidia/tool-primary", "nvidia/tool-primary"]);
  });

  it("caps Claude tool output and terminates repeated planning prose", async () => {
    let routedMaxTokens;
    let cancelled = false;
    const phrase = "Actually, let me look at the exact context and then I will run the Read tool. ";
    const repeated = phrase.repeat(30);
    const event = `event: content_block_start\ndata: ${JSON.stringify({
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    })}\n\nevent: content_block_delta\ndata: ${JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: repeated },
    })}\n\n`;
    const response = await handleComboChat({
      body: {
        max_tokens: 128_000,
        tools: [{ name: "Read", input_schema: { type: "object" } }],
        messages: [{ role: "user", content: "inspect it" }],
      },
      models: ["nvidia/looping"],
      comboName: "claude-opus-4-8",
      comboStrategy: "fallback",
      modelCooldownMs: 1_000,
      log: { info() {}, warn() {} },
      handleSingleModel: async (routedBody) => {
        routedMaxTokens = routedBody.max_tokens;
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(event));
          },
          cancel() {
            cancelled = true;
          },
        }), {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      },
    });

    const text = await response.text();
    expect(routedMaxTokens).toBe(8_192);
    expect(cancelled).toBe(true);
    expect(text).toContain("event: message_stop");
    expect(text).toContain('"stop_reason":"end_turn"');
  });

  it("falls back before malformed Claude tool JSON reaches the CLI", async () => {
    const attempts = [];
    const logs = [];
    const toolStream = (partialJson) => [
      `event: content_block_start\ndata: ${JSON.stringify({
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "tool_1", name: "Bash", input: {} },
      })}\n\n`,
      `event: content_block_delta\ndata: ${JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: partialJson },
      })}\n\n`,
      `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`,
      `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
    ].join("");

    const response = await handleComboChat({
      body: {
        tools: [{ name: "Bash", input_schema: { type: "object" } }],
        messages: [{ role: "user", content: "run the tests" }],
      },
      models: ["oc/big-pickle", "oc/valid-tools"],
      comboName: "claude-auto",
      comboStrategy: "fallback",
      modelCooldownMs: 60_000,
      log: {
        info() {},
        warn(_scope, message) { logs.push(message); },
      },
      handleSingleModel: async (_body, model) => {
        attempts.push(model);
        const args = model === "oc/big-pickle"
          ? '{"command":"npm test"'
          : '{"command":"npm test"}';
        return new Response(toolStream(args), {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      },
    });

    expect(attempts).toEqual(["oc/big-pickle", "oc/valid-tools"]);
    expect(logs.some((message) => message.includes("invalid Claude tool stream"))).toBe(true);
    const text = await response.text();
    expect(text).toContain('"partial_json":"{\\"command\\":\\"npm test\\"}"');
    expect(text).not.toContain('"partial_json":"{\\"command\\":\\"npm test\\""');
  });
});
