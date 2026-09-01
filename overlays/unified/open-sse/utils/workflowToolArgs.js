const WORKFLOW_TOOL_NAMES = new Set(["workflow"]);

function normalizedToolName(toolName) {
  return String(toolName || "").replace(/^proxy_/, "").toLowerCase();
}

function skipQuoted(source, start) {
  const quote = source[start];
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === "\\") {
      index += 1;
      continue;
    }
    if (source[index] === quote) return index + 1;
  }
  return -1;
}

function skipComment(source, start) {
  if (source[start + 1] === "/") {
    const end = source.indexOf("\n", start + 2);
    return end < 0 ? source.length : end + 1;
  }
  if (source[start + 1] === "*") {
    const end = source.indexOf("*/", start + 2);
    return end < 0 ? -1 : end + 2;
  }
  return start;
}

function matchingDelimiter(source, start, open, close) {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === "'" || char === '"' || char === "`") {
      const next = skipQuoted(source, index);
      if (next < 0) return -1;
      index = next - 1;
      continue;
    }
    if (char === "/" && (source[index + 1] === "/" || source[index + 1] === "*")) {
      const next = skipComment(source, index);
      if (next < 0) return -1;
      index = next - 1;
      continue;
    }
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return index;
      if (depth < 0) return -1;
    }
  }
  return -1;
}

function splitTopLevelProperties(source) {
  const properties = [];
  let start = 0;
  const stack = [];
  const closing = { "(": ")", "[": "]", "{": "}" };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "'" || char === '"' || char === "`") {
      const next = skipQuoted(source, index);
      if (next < 0) return null;
      index = next - 1;
      continue;
    }
    if (char === "/" && (source[index + 1] === "/" || source[index + 1] === "*")) {
      const next = skipComment(source, index);
      if (next < 0) return null;
      index = next - 1;
      continue;
    }
    if (closing[char]) stack.push(closing[char]);
    else if (stack.at(-1) === char) stack.pop();
    else if (char === "," && stack.length === 0) {
      properties.push(source.slice(start, index));
      start = index + 1;
    }
  }
  if (stack.length > 0) return null;
  properties.push(source.slice(start));
  return properties;
}

function findAgentObjectMatches(source) {
  const matches = [];
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "'" || char === '"' || char === "`") {
      const next = skipQuoted(source, index);
      if (next < 0) return [];
      index = next - 1;
      continue;
    }
    if (char === "/" && (source[index + 1] === "/" || source[index + 1] === "*")) {
      const next = skipComment(source, index);
      if (next < 0) return [];
      index = next - 1;
      continue;
    }
    if (!source.startsWith("agent", index)) continue;
    if (/[A-Za-z0-9_$]/.test(source[index - 1] || "")) continue;
    if (/[A-Za-z0-9_$]/.test(source[index + 5] || "")) continue;
    let cursor = index + 5;
    while (/\s/.test(source[cursor] || "")) cursor += 1;
    if (source[cursor] !== "(") continue;
    cursor += 1;
    while (/\s/.test(source[cursor] || "")) cursor += 1;
    if (source[cursor] === "{") matches.push({ index });
  }
  return matches;
}

function rewriteAgentObjectCall(source, match) {
  const openBrace = source.indexOf("{", match.index);
  if (openBrace < 0) return null;
  const closeBrace = matchingDelimiter(source, openBrace, "{", "}");
  if (closeBrace < 0) return null;

  let closeParen = closeBrace + 1;
  while (/\s/.test(source[closeParen] || "")) closeParen += 1;
  if (source[closeParen] !== ")") return null;

  const properties = splitTopLevelProperties(source.slice(openBrace + 1, closeBrace));
  if (!properties) return null;
  const promptProperties = properties
    .map((property, index) => ({
      index,
      match: property.match(/^\s*(?:prompt|["']prompt["'])\s*:\s*/),
    }))
    .filter(({ match: propertyMatch }) => propertyMatch);
  if (promptProperties.length !== 1) return null;

  const promptProperty = promptProperties[0];
  const promptExpression = properties[promptProperty.index]
    .slice(promptProperty.match[0].length)
    .trim();
  if (!promptExpression) return null;
  const optionProperties = properties
    .filter((_, index) => index !== promptProperty.index)
    .map((property) => property.trim())
    .filter(Boolean);
  const optionsExpression = optionProperties.length > 0
    ? `{\n  ${optionProperties.join(",\n  ")}\n}`
    : "{}";

  return {
    start: match.index,
    end: closeParen + 1,
    value: `agent(${promptExpression}, ${optionsExpression})`,
  };
}

/**
 * Claude Code Workflow scripts call agent(prompt, options). Some routed models
 * instead emit agent({ prompt, ...options }), which the runtime stringifies to
 * "[object]" and silently dispatches without its task. Rewrite only that exact,
 * statically recognizable mistake and leave every ambiguous script untouched.
 */
export function repairWorkflowScript(script) {
  const source = String(script || "");
  const matches = findAgentObjectMatches(source);
  if (matches.length === 0) return { script: source, repaired: false, calls: 0 };

  const replacements = [];
  for (const match of matches) {
    const replacement = rewriteAgentObjectCall(source, match);
    if (replacement) replacements.push(replacement);
  }
  if (replacements.length === 0) return { script: source, repaired: false, calls: 0 };

  let repaired = source;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    repaired = `${repaired.slice(0, replacement.start)}${replacement.value}${repaired.slice(replacement.end)}`;
  }
  return { script: repaired, repaired: true, calls: replacements.length };
}

export function repairWorkflowToolInput(toolName, input) {
  if (
    !WORKFLOW_TOOL_NAMES.has(normalizedToolName(toolName))
    || !input
    || typeof input !== "object"
    || typeof input.script !== "string"
  ) {
    return { input, repaired: false, calls: 0 };
  }
  const result = repairWorkflowScript(input.script);
  if (!result.repaired) return { input, repaired: false, calls: 0 };
  return {
    input: { ...input, script: result.script },
    repaired: true,
    calls: result.calls,
  };
}
