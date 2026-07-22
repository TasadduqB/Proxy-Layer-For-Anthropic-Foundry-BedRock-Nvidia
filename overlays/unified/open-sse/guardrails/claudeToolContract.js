const TOOL_CONTRACT_MARKER = "[PROXY_MAX_CLAUDE_TOOL_CONTRACT]";
const TOOL_CONTRACT_END = "[/PROXY_MAX_CLAUDE_TOOL_CONTRACT]";
const COLLABORATION_TOOL_NAMES = new Set(["Agent", "SendMessage"]);

function requiredFields(tool) {
  const fields = tool?.input_schema?.required;
  if (!Array.isArray(fields)) return [];
  return fields.filter((field) => typeof field === "string" && field.length > 0);
}

export function buildClaudeToolContract(tools) {
  if (!Array.isArray(tools)) return "";

  const collaborationTools = tools.filter((tool) => COLLABORATION_TOOL_NAMES.has(tool?.name));
  if (collaborationTools.length === 0) return "";

  const requiredLines = collaborationTools.map((tool) => {
    const fields = requiredFields(tool);
    return fields.length > 0
      ? `- ${tool.name} requires: ${fields.join(", ")}.`
      : `- ${tool.name}: follow its input schema exactly.`;
  });

  return `${TOOL_CONTRACT_MARKER}
Tool input schemas are executable contracts, not suggestions.
- Before every tool call, include every field listed in that tool's required array and use only declared field names.
${requiredLines.join("\n")}
- SendMessage is only for another running agent. Do not use it to answer or notify the user. In the main conversation, do not address "main"; only background agents may do that.
- Do not spawn an Agent merely to announce completion, discover message recipients, or work around a rejected SendMessage call.
- When the requested work is complete, answer the user directly in normal text. Do not call Agent, SendMessage, or TaskList merely to announce or reconfirm completion.
${TOOL_CONTRACT_END}`;
}

export function injectClaudeToolContract(messages, tools) {
  if (!Array.isArray(messages)) return false;
  const contract = buildClaudeToolContract(tools);
  if (!contract) return false;

  const existingSystem = messages.find((message) => message?.role === "system");
  if (typeof existingSystem?.content === "string") {
    if (existingSystem.content.includes(TOOL_CONTRACT_MARKER)) return false;
    existingSystem.content = `${existingSystem.content}\n\n${contract}`;
    return true;
  }

  messages.unshift({ role: "system", content: contract });
  return true;
}

export { TOOL_CONTRACT_MARKER };
