import { describe, expect, it } from "vitest";

import {
  repairWorkflowScript,
  repairWorkflowToolInput,
} from "../../open-sse/utils/workflowToolArgs.js";

describe("Workflow agent argument repair", () => {
  it("moves prompt out of the options object", () => {
    const script = `
const result = await agent({
  label: "Create architecture spec",
  phase: "Architecture",
  schema: { type: "object", required: ["status"] },
  prompt: \`Create the spec with an ASCII diagram: { API }.\`,
});
`;
    const result = repairWorkflowScript(script);

    expect(result.repaired).toBe(true);
    expect(result.calls).toBe(1);
    expect(result.script).toContain("agent(`Create the spec with an ASCII diagram: { API }.`, {");
    expect(result.script).toContain('label: "Create architecture spec"');
    expect(result.script).toContain('schema: { type: "object", required: ["status"] }');
    expect(result.script).not.toContain("agent({");
    expect(result.script).not.toContain("prompt:");
  });

  it("repairs every invalid agent call in one workflow", () => {
    const script = `
await agent({ prompt: "first", label: "one" });
await agent({
  schema: { type: "object" },
  prompt: "second",
});
`;
    const result = repairWorkflowToolInput("Workflow", { description: "demo", script });

    expect(result.repaired).toBe(true);
    expect(result.calls).toBe(2);
    expect(result.input.script).toContain('agent("first", {');
    expect(result.input.script).toContain('agent("second", {');
  });

  it("leaves the documented two-argument signature unchanged", () => {
    const script = 'await agent("do the task", { label: "worker", schema });';
    expect(repairWorkflowScript(script)).toEqual({
      script,
      repaired: false,
      calls: 0,
    });
  });

  it("leaves ambiguous object calls without a prompt unchanged", () => {
    const script = 'await agent({ label: "worker", schema });';
    expect(repairWorkflowScript(script)).toEqual({
      script,
      repaired: false,
      calls: 0,
    });
  });

  it("does not rewrite agent-like text inside prompts or comments", () => {
    const script = `
// Example only: agent({ prompt: "comment" })
const guidance = \`Do not call agent({ prompt: "nested" })\`;
await agent({ prompt: "real task", label: "worker" });
`;
    const result = repairWorkflowScript(script);

    expect(result.calls).toBe(1);
    expect(result.script).toContain('agent({ prompt: "comment" })');
    expect(result.script).toContain('agent({ prompt: "nested" })');
    expect(result.script).toContain('agent("real task", {');
  });
});
