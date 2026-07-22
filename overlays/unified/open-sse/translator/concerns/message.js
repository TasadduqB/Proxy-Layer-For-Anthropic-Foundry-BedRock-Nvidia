import { OPENAI_BLOCK } from "../schema/index.js";

// Collapse an OpenAI content-part array when every part is plain text. A string
// is accepted by more OpenAI-compatible servers than an array, while mixed media
// and text blocks carrying metadata must retain their structured representation.
export function collapseTextParts(parts) {
  if (!Array.isArray(parts) || parts.length === 0) return parts;
  const isPlainText = parts.every((part) => {
    if (!part || part.type !== OPENAI_BLOCK.TEXT) return false;
    return Object.keys(part).every((key) => key === "type" || key === "text");
  });
  return isPlainText ? parts.map((part) => String(part.text ?? "")).join("\n") : parts;
}
