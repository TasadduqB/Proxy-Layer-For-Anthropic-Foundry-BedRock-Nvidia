import { describe, expect, it } from "vitest";

import {
  buildClaudeToolContract,
  injectClaudeToolContract,
} from "../../open-sse/guardrails/claudeToolContract.js";
import { claudeToOpenAIRequest } from "../../open-sse/translator/request/claude-to-openai.js";

describe("Claude Code dynamic tool contract", () => {
  const tools = [
    {
      name: "Edit",
      input_schema: {
        type: "object",
        required: ["file_path", "old_string", "new_string"],
      },
    },
    {
      name: "Bash",
      input_schema: {
        type: "object",
        required: ["command"],
      },
    },
    {
      name: "mcp__custom__lookup",
      input_schema: {
        type: "object",
        required: ["query"],
      },
    },
  ];

  it("covers every client-supplied built-in and MCP tool", () => {
    const contract = buildClaudeToolContract(tools);
    expect(contract).toContain("Edit requires: file_path, old_string, new_string.");
    expect(contract).toContain("Bash requires: command.");
    expect(contract).toContain("mcp__custom__lookup requires: query.");
    expect(contract).toContain("There is no generic Wait tool unless Wait is explicitly listed");
    expect(contract).toContain("${NAME:?message}");
    expect(contract).toContain("old_string must match current file text exactly");
  });

  it("injects for ordinary Claude Code tools without collaboration tools", () => {
    const messages = [{ role: "user", content: "edit the file" }];
    expect(injectClaudeToolContract(messages, tools)).toBe(true);
    expect(messages[0]).toMatchObject({ role: "system" });
    expect(messages[0].content).toContain("Every tool listed below");
  });

  it("does not reject or filter future tool names", () => {
    const contract = buildClaudeToolContract([{
      name: "FutureClaudeTool",
      input_schema: { type: "object", required: ["value"] },
    }]);
    expect(contract).toContain("FutureClaudeTool requires: value.");
  });

  it("preserves the current Claude Code built-ins plus arbitrary MCP tools", () => {
    const currentBuiltIns = [
      "Agent",
      "AskUserQuestion",
      "Bash",
      "CronCreate",
      "CronDelete",
      "CronList",
      "Edit",
      "EnterPlanMode",
      "EnterWorktree",
      "ExitPlanMode",
      "ExitWorktree",
      "Glob",
      "Grep",
      "Read",
      "ReadMcpResourceTool",
      "Skill",
      "TaskCreate",
      "TaskGet",
      "TaskList",
      "TaskOutput",
      "TaskStop",
      "TaskUpdate",
      "TeamCreate",
      "TeamDelete",
      "TodoWrite",
      "ToolSearch",
      "WebFetch",
      "WebSearch",
      "Write",
      "Workflow",
      "SendMessage",
      "mcp__filesystem__custom_action",
      "FutureClaudeTool",
    ];
    const definitions = currentBuiltIns.map((name) => ({
      name,
      description: `${name} description`,
      input_schema: {
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"],
      },
    }));

    const translated = claudeToOpenAIRequest("test-model", {
      messages: [{ role: "user", content: "test" }],
      tools: definitions,
    }, true);

    expect(translated.tools.map((tool) => tool.function.name)).toEqual(currentBuiltIns);
    expect(translated.tools.every((tool) => (
      tool.function.parameters.required?.[0] === "value"
    ))).toBe(true);
  });
});
