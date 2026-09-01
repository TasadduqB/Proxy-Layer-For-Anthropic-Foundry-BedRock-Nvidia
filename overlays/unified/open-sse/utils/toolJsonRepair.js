function parseObject(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseAdjacentObjects(value) {
  const text = String(value || "").trim();
  const values = [];
  let offset = 0;
  while (offset < text.length) {
    while (/\s/.test(text[offset] || "")) offset += 1;
    if (text[offset] !== "{") return null;
    const start = offset;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let ended = false;
    for (; offset < text.length; offset += 1) {
      const char = text[offset];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          const parsed = parseObject(text.slice(start, offset + 1));
          if (!parsed) return null;
          values.push(parsed);
          offset += 1;
          ended = true;
          break;
        }
      }
    }
    if (!ended) return null;
  }
  return values.length > 1 ? values : null;
}

const VALID_ESCAPE_CHARS = new Set(['"', "\\", "/", "b", "f", "n", "r", "t"]);

function sanitizeStringDefects(value) {
  let result = "";
  let inString = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const code = value.charCodeAt(index);
    if (char === '"') {
      inString = !inString;
      result += char;
      continue;
    }
    if (inString && char === "\\") {
      const next = value[index + 1];
      if (next === "u" && /^[0-9a-fA-F]{4}$/.test(value.slice(index + 2, index + 6))) {
        result += value.slice(index, index + 6);
        index += 5;
      } else if (next !== undefined && VALID_ESCAPE_CHARS.has(next)) {
        result += `\\${next}`;
        index += 1;
      } else {
        result += "\\\\";
      }
      continue;
    }
    if (inString && code < 0x20) {
      if (code === 0x0a) result += "\\n";
      else if (code === 0x0d) result += "\\r";
      else if (code === 0x09) result += "\\t";
      else result += `\\u${code.toString(16).padStart(4, "0")}`;
      continue;
    }
    result += char;
  }
  return result;
}

function escapeInnerQuotes(value) {
  let result = "";
  let inString = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (!inString) {
      result += char;
      if (char === '"') inString = true;
      continue;
    }
    if (char === "\\") {
      result += char;
      if (index + 1 < value.length) {
        result += value[index + 1];
        index += 1;
      }
      continue;
    }
    if (char === '"') {
      let nextIndex = index + 1;
      while (/\s/.test(value[nextIndex] || "")) nextIndex += 1;
      const next = value[nextIndex];
      if (next === undefined || next === "," || next === "}" || next === "]" || next === ":") {
        result += char;
        inString = false;
      } else {
        result += '\\"';
      }
      continue;
    }
    result += char;
  }
  return result;
}

function hasRequiredFields(input, requiredFields) {
  return requiredFields.every((field) => Object.hasOwn(input, field));
}

function completeStructuralSuffix(value) {
  const stack = [];
  let inString = false;
  let escaped = false;
  for (const char of value) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") stack.push("}");
    else if (char === "[") stack.push("]");
    else if (char === "}" || char === "]") {
      if (stack.pop() !== char) return null;
    }
  }
  // Never invent the rest of a truncated string value (task id, path,
  // command, etc.). Appending only missing structural delimiters preserves
  // every complete value exactly as the provider emitted it.
  if (inString || stack.length === 0) return null;
  return `${value}${stack.reverse().join("")}`;
}

/**
 * Repair only syntax defects that preserve the complete argument payload.
 * By default, does not close truncated strings/braces: executing an incomplete
 * Bash, Edit, Write, or collaboration call is less safe than retrying a model.
 * Observational callers may opt into structural-only suffix completion.
 */
export function repairClaudeToolJson(rawValue, requiredFields = [], options = {}) {
  const raw = String(rawValue || "").trim();
  if (!raw) return { repaired: false, reason: "empty" };

  const direct = parseObject(raw);
  if (direct) {
    return hasRequiredFields(direct, requiredFields)
      ? { repaired: false, input: direct, value: raw }
      : { repaired: false, reason: "missing-required" };
  }

  const snapshots = parseAdjacentObjects(raw);
  if (snapshots) {
    const input = snapshots.at(-1);
    return hasRequiredFields(input, requiredFields)
      ? { repaired: true, input, value: JSON.stringify(input), reason: "repeated-snapshots" }
      : { repaired: false, reason: "missing-required" };
  }

  const candidates = [];
  const sanitized = sanitizeStringDefects(raw);
  candidates.push({ value: sanitized, reason: "string-escapes" });
  candidates.push({ value: escapeInnerQuotes(sanitized), reason: "inner-quotes" });
  candidates.push({
    value: escapeInnerQuotes(sanitized).replace(/,\s*([}\]])/g, "$1"),
    reason: "trailing-comma",
  });

  for (const candidate of candidates) {
    const input = parseObject(candidate.value);
    if (!input || !hasRequiredFields(input, requiredFields)) continue;
    return { repaired: true, input, value: JSON.stringify(input), reason: candidate.reason };
  }

  if (options.allowStructuralCompletion === true) {
    const completed = completeStructuralSuffix(escapeInnerQuotes(sanitized));
    const normalized = completed?.replace(/,\s*([}\]])/g, "$1");
    const input = normalized ? parseObject(normalized) : null;
    if (input && hasRequiredFields(input, requiredFields)) {
      return {
        repaired: true,
        input,
        value: JSON.stringify(input),
        reason: "structural-suffix",
      };
    }
  }
  return { repaired: false, reason: "unrecoverable" };
}
