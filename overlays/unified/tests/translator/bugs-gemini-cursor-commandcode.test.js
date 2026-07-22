// OpenAI → Gemini / Cursor / CommandCode request translation.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const O2G = (body) => translateRequest(FORMATS.OPENAI, FORMATS.GEMINI, "m", body, true, null, "gemini");
const O2C = (body) => translateRequest(FORMATS.OPENAI, FORMATS.CURSOR, "m", body, true, null, "cursor");
const O2CC = (body) => translateRequest(FORMATS.OPENAI, FORMATS.COMMANDCODE, "m", body, true, null, "commandcode");

describe("OpenAI → Gemini", () => {
  it("multiple system messages are all kept", () => {
    const out = O2G({
      messages: [
        { role: "system", content: "RULE_ONE" },
        { role: "system", content: "RULE_TWO" },
        { role: "user", content: "hi" },
      ],
    });
    expect(JSON.stringify(out.systemInstruction), "earlier system lost").toContain("RULE_ONE");
  });
});

describe("OpenAI → Cursor", () => {
  it("image content is preserved", () => {
    const out = O2C({
      messages: [{ role: "user", content: [
        { type: "text", text: "look" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
      ] }],
    });
    expect(JSON.stringify(out), "image dropped").toContain("AAAA");
  });

  it("respects client max_tokens", () => {
    const out = O2C({ max_tokens: 200, messages: [{ role: "user", content: "hi" }] });
    expect(out.max_tokens).toBe(200);
  });

  it("preserves system and tool-result roles for AgentService history", () => {
    const out = O2C({
      messages: [
        { role: "system", content: "be brief" },
        { role: "user", content: "weather?" },
        { role: "assistant", content: null, tool_calls: [
          { id: "call_1", type: "function", function: { name: "weather", arguments: "{}" } },
        ] },
        { role: "tool", tool_call_id: "call_1", content: "sunny" },
      ],
    });
    expect(out.messages[0]).toEqual({ role: "system", content: "be brief" });
    expect(out.messages.at(-1)).toMatchObject({
      role: "tool",
      tool_call_id: "call_1",
      content: "sunny",
    });
  });
});

describe("OpenAI → CommandCode", () => {
  it("malformed tool arguments are not silently emptied", () => {
    const out = O2CC({
      messages: [
        { role: "user", content: "go" },
        { role: "assistant", content: "", tool_calls: [
          { id: "c1", type: "function", function: { name: "f", arguments: "{bad" } },
        ] },
        { role: "tool", tool_call_id: "c1", content: "r" },
      ],
    });
    const asst = out.params.messages.find((m) => m.role === "assistant");
    const call = asst.content.find((b) => b.type === "tool-call");
    expect(Object.keys(call.input).length, "arguments silently dropped to {}").toBeGreaterThan(0);
  });

  it("image content is preserved", () => {
    const out = O2CC({
      messages: [{ role: "user", content: [
        { type: "text", text: "look" },
        { type: "image_url", image_url: { url: "data:image/png;base64,BBBB" } },
      ] }],
    });
    expect(JSON.stringify(out), "image omitted").toContain("BBBB");
  });
});
