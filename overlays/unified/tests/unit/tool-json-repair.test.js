import { describe, expect, it } from "vitest";

import { repairClaudeToolJson } from "../../open-sse/utils/toolJsonRepair.js";

describe("Claude tool JSON repair", () => {
  it("repairs raw quotes inside a complete Edit argument", () => {
    const result = repairClaudeToolJson(
      '{"file_path":"a.js","new_string":"const x = "hello";"}',
      ["file_path", "new_string"],
    );

    expect(result.repaired).toBe(true);
    expect(result.input).toEqual({
      file_path: "a.js",
      new_string: 'const x = "hello";',
    });
  });

  it("repairs invalid backslashes and literal control characters", () => {
    const result = repairClaudeToolJson(
      '{"command":"printf C:\\project\\workspace\nnext"}',
      ["command"],
    );

    expect(result.repaired).toBe(true);
    expect(result.input.command).toContain("project");
    expect(result.input.command).toContain("\n");
  });

  it("keeps the final complete object from repeated snapshots", () => {
    const result = repairClaudeToolJson(
      '{"command":"first"}{"command":"second"}',
      ["command"],
    );

    expect(result).toMatchObject({
      repaired: true,
      input: { command: "second" },
      reason: "repeated-snapshots",
    });
  });

  it("does not complete or execute truncated tool input", () => {
    expect(repairClaudeToolJson(
      '{"command":"git push --force',
      ["command"],
    )).toEqual({
      repaired: false,
      reason: "unrecoverable",
    });
  });

  it("can complete only missing structural delimiters for an observational tool", () => {
    expect(repairClaudeToolJson(
      '{"monitor_id":"agent-123","include_output":true',
      ["monitor_id"],
      { allowStructuralCompletion: true },
    )).toMatchObject({
      repaired: true,
      reason: "structural-suffix",
      input: { monitor_id: "agent-123", include_output: true },
    });
  });

  it("does not invent the rest of a truncated observational string", () => {
    expect(repairClaudeToolJson(
      '{"monitor_id":"agent-',
      ["monitor_id"],
      { allowStructuralCompletion: true },
    )).toEqual({
      repaired: false,
      reason: "unrecoverable",
    });
  });

  it("rejects syntactically valid input missing required fields", () => {
    expect(repairClaudeToolJson("{}", ["command"])).toEqual({
      repaired: false,
      reason: "missing-required",
    });
  });
});
