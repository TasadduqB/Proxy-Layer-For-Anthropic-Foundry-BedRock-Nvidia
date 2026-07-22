import fs from "node:fs";
import path from "node:path";

const MAX_EDIT_FILE_BYTES = 8 * 1024 * 1024;
const EDIT_TOOL_NAMES = new Set(["edit", "update", "str_replace_editor", "multiedit"]);
const PATH_FIELDS = ["file_path", "filePath", "path"];
const OLD_FIELDS = ["old_string", "oldString", "old_str", "oldText"];
const NEW_FIELDS = ["new_string", "newString", "new_str", "newText"];

function firstStringField(input, names) {
  for (const name of names) {
    if (typeof input?.[name] === "string") return name;
  }
  return null;
}

function normalizedToolName(toolName) {
  const name = String(toolName || "").replace(/^proxy_/, "").toLowerCase();
  return name.endsWith(".edit") ? "edit" : name;
}

function leadingWhitespace(value) {
  return String(value || "").match(/^[\t ]*/)?.[0] || "";
}

function firstNonBlankIndent(value) {
  for (const line of String(value || "").replace(/\r\n?/g, "\n").split("\n")) {
    if (line.trim()) return leadingWhitespace(line);
  }
  return "";
}

function addBaseIndent(value, indent) {
  if (!indent) return value;
  return String(value).replace(/(^|\n)(?=[^\n]*\S)/g, `$1${indent}`);
}

function dedentLines(lines) {
  const widths = lines
    .filter((line) => String(line).trim())
    .map((line) => leadingWhitespace(line).length);
  const commonWidth = widths.length > 0 ? Math.min(...widths) : 0;
  return lines.map((line) => (
    String(line).trim() ? String(line).slice(commonWidth).trimEnd() : ""
  ));
}

/**
 * Find the exact file slice for an edit string whose only mismatch is line
 * indentation/edge whitespace. Ambiguous matches are deliberately rejected.
 */
export function findUniqueWhitespaceMatch(fileContent, requested) {
  const content = String(fileContent || "");
  const oldString = String(requested || "");
  if (!oldString || content.includes(oldString)) return null;

  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const fileLines = content.replace(/\r\n?/g, "\n").split("\n");
  const normalizedOld = oldString.replace(/\r\n?/g, "\n");
  const hadTrailingEol = normalizedOld.endsWith("\n");
  const oldLines = normalizedOld.split("\n");
  if (hadTrailingEol) oldLines.pop();
  if (oldLines.length === 0 || oldLines.every((line) => !line.trim())) return null;

  const matches = [];
  const comparableOld = dedentLines(oldLines);
  const lastStart = fileLines.length - oldLines.length;
  for (let start = 0; start <= lastStart; start += 1) {
    const candidate = fileLines.slice(start, start + oldLines.length);
    const comparableCandidate = dedentLines(candidate);
    const matched = comparableCandidate.every((line, offset) => line === comparableOld[offset]);
    if (!matched) continue;

    let exact = candidate.join(eol);
    if (hadTrailingEol) exact += eol;
    matches.push(exact);
  }

  if (matches.length === 1) return matches[0];
  if (matches.length > 1 && matches.every((match) => match === matches[0])) return matches[0];
  return null;
}

function comparableLine(line) {
  return String(line || "").trim();
}

function isOrderedLineMatch(candidate, requested) {
  let requestedIndex = 0;
  for (const line of candidate) {
    if (comparableLine(line) === comparableLine(requested[requestedIndex])) {
      requestedIndex += 1;
      if (requestedIndex === requested.length) return true;
    }
  }
  return false;
}

/**
 * Find a unique block when the file contains a few newly inserted lines but
 * every line from the model's prior read is still present in the same order.
 * This specifically handles read/edit races without accepting deletions,
 * rewrites, reordered lines, or ambiguous occurrences.
 */
export function findUniqueStaleBlockMatch(fileContent, requested, options = {}) {
  const content = String(fileContent || "");
  const oldString = String(requested || "");
  if (!oldString || content.includes(oldString)) return null;

  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const fileLines = content.replace(/\r\n?/g, "\n").split("\n");
  const normalizedOld = oldString.replace(/\r\n?/g, "\n");
  const hadTrailingEol = normalizedOld.endsWith("\n");
  const oldLines = normalizedOld.split("\n");
  if (hadTrailingEol) oldLines.pop();
  while (oldLines.length > 0 && !oldLines[0].trim()) oldLines.shift();
  while (oldLines.length > 0 && !oldLines.at(-1).trim()) oldLines.pop();

  const nonBlankCount = oldLines.filter((line) => line.trim()).length;
  if (nonBlankCount < 3) return null;
  const requestedMax = Number(options.maxInsertedLines);
  const maxInsertedLines = Number.isInteger(requestedMax) && requestedMax >= 0
    ? Math.min(requestedMax, 8)
    : Math.min(8, Math.max(4, Math.ceil(oldLines.length * 0.25)));
  const firstLine = comparableLine(oldLines[0]);
  const lastLine = comparableLine(oldLines.at(-1));
  if (!firstLine || !lastLine) return null;

  const matches = [];
  for (let start = 0; start < fileLines.length; start += 1) {
    if (comparableLine(fileLines[start]) !== firstLine) continue;
    const minLength = oldLines.length;
    const maxLength = Math.min(oldLines.length + maxInsertedLines, fileLines.length - start);
    for (let length = minLength; length <= maxLength; length += 1) {
      const candidate = fileLines.slice(start, start + length);
      if (comparableLine(candidate.at(-1)) !== lastLine) continue;
      if (!isOrderedLineMatch(candidate, oldLines)) continue;
      let exact = candidate.join(eol);
      if (hadTrailingEol) exact += eol;
      matches.push(exact);
    }
  }

  if (matches.length === 1) return matches[0];
  if (matches.length > 1 && matches.every((match) => match === matches[0])) return matches[0];
  return null;
}

function safeLocalFile(filePath) {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) return null;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > MAX_EDIT_FILE_BYTES) return null;
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Repair a Claude Code Edit/Update call only when the proposed old text has a
 * unique whitespace-insensitive or bounded stale-context match in the target
 * file. The exact file text is restored and the same missing base indentation
 * is applied to new_string.
 * No file is ever written here; Claude Code remains the edit executor.
 */
export function repairEditToolInput(toolName, input) {
  if (!EDIT_TOOL_NAMES.has(normalizedToolName(toolName)) || !input || typeof input !== "object") {
    return { input, repaired: false };
  }

  const pathField = firstStringField(input, PATH_FIELDS);
  const oldField = firstStringField(input, OLD_FIELDS);
  if (!pathField || !oldField || !input[oldField]) return { input, repaired: false };

  const content = safeLocalFile(input[pathField]);
  if (content === null || content.includes(input[oldField])) return { input, repaired: false };

  const exactOld = findUniqueWhitespaceMatch(content, input[oldField])
    || findUniqueStaleBlockMatch(content, input[oldField]);
  if (!exactOld) return { input, repaired: false };

  const repaired = { ...input, [oldField]: exactOld };
  const newField = firstStringField(input, NEW_FIELDS);
  if (newField) {
    const requestedIndent = firstNonBlankIndent(input[oldField]);
    const exactIndent = firstNonBlankIndent(exactOld);
    if (exactIndent.startsWith(requestedIndent)) {
      repaired[newField] = addBaseIndent(input[newField], exactIndent.slice(requestedIndent.length));
    }
  }

  return { input: repaired, repaired: true };
}
