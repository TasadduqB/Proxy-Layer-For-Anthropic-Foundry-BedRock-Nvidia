import { describe, expect, it } from "vitest";
import { CursorExecutor } from "../../open-sse/executors/cursor.js";
import {
  decodeMessage,
  encodeAgentValue,
  encodeField,
  wrapConnectRPCFrame,
} from "../../open-sse/utils/cursorProtobuf.js";

const LEN = 2;
const VARINT = 0;
const bytes = (...parts) => Buffer.concat(parts.map((part) => Buffer.from(part)));

function mcpArgsFrame({ id = 7, callId = "call_weather", name = "get_weather", args = {} } = {}) {
  const entries = Object.entries(args).map(([key, value]) => encodeField(2, LEN, bytes(
    encodeField(1, LEN, key),
    encodeField(2, LEN, encodeAgentValue(value)),
  )));
  const mcpArgs = bytes(
    encodeField(1, LEN, name),
    ...entries,
    encodeField(3, LEN, callId),
    encodeField(4, LEN, "proxy-max"),
    encodeField(5, LEN, name),
  );
  const execRequest = bytes(
    encodeField(1, VARINT, id),
    encodeField(11, LEN, mcpArgs),
  );
  return wrapConnectRPCFrame(encodeField(2, LEN, execRequest));
}

function contextFrame(id = 42) {
  const execRequest = bytes(
    encodeField(1, VARINT, id),
    encodeField(10, LEN, new Uint8Array()),
  );
  return wrapConnectRPCFrame(encodeField(2, LEN, execRequest));
}

function doneFrame() {
  const update = encodeField(14, LEN, new Uint8Array());
  return wrapConnectRPCFrame(encodeField(1, LEN, update));
}

function fakeSession(frames) {
  const queue = [...frames];
  return {
    responseHeaders: Promise.resolve({ ":status": 200 }),
    writes: [],
    ended: false,
    closed: false,
    write(frame) { this.writes.push(Buffer.from(frame)); },
    end() { this.ended = true; },
    close() { this.closed = true; },
    async read() {
      if (queue.length) return { value: Buffer.from(queue.shift()), done: false };
      return { value: undefined, done: true };
    },
  };
}

function executorWithSession(session) {
  const executor = new CursorExecutor();
  executor.openAgentHttp2Stream = () => session;
  return executor;
}

const credentials = {
  accessToken: "test-token",
  providerSpecificData: { machineId: "test-machine", ghostMode: true },
};

describe("Cursor AgentService execution", () => {
  it("returns an MCP request as an OpenAI tool call and sends declared tools", async () => {
    const session = fakeSession([mcpArgsFrame({ args: { city: "Tokyo", count: 2 } })]);
    const executor = executorWithSession(session);
    const body = {
      messages: [{ role: "user", content: "weather?" }],
      tools: [{
        type: "function",
        function: { name: "get_weather", parameters: { type: "object" } },
      }],
    };

    const result = await executor.executeAgent({
      model: "gpt-5.2",
      body,
      stream: false,
      credentials,
    });
    const json = await result.response.json();

    expect(json.choices[0].finish_reason).toBe("tool_calls");
    expect(json.choices[0].message.tool_calls).toEqual([{
      id: "call_weather",
      type: "function",
      function: { name: "get_weather", arguments: '{"city":"Tokyo","count":2}' },
    }]);
    const run = decodeMessage(decodeMessage(session.writes[0].subarray(5)).get(1)[0].value);
    expect(run.has(4)).toBe(true);
    expect(session.closed).toBe(true);
  });

  it("streams MCP requests with tool_calls finish semantics", async () => {
    const session = fakeSession([mcpArgsFrame({ args: { city: "Delhi" } })]);
    const executor = executorWithSession(session);
    const result = await executor.executeAgent({
      model: "gpt-5.2",
      body: { messages: [{ role: "user", content: "weather?" }] },
      stream: true,
      credentials,
    });
    const output = await result.response.text();

    expect(output).toContain('"tool_calls"');
    expect(output).toContain('"get_weather"');
    expect(output).toContain('"finish_reason":"tool_calls"');
    expect(output).toContain("data: [DONE]");
  });

  it("echoes the ExecServerMessage id in request-context responses", async () => {
    const session = fakeSession([contextFrame(42), doneFrame()]);
    const executor = executorWithSession(session);
    const result = await executor.executeAgent({
      model: "gpt-5.2",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials,
    });

    expect((await result.response.json()).choices[0].finish_reason).toBe("stop");
    expect(session.writes).toHaveLength(2);
    const clientMessage = decodeMessage(session.writes[1].subarray(5));
    const execResponse = decodeMessage(clientMessage.get(2)[0].value);
    expect(execResponse.get(1)[0].value).toBe(42);
    expect(execResponse.has(10)).toBe(true);
  });
});
