/**
 * Convert an OpenAI-compatible list entry into Anthropic's model-detail
 * response. Claude Code validates a selected model with GET /v1/models/:id
 * before it starts a conversation, so aliases and combo-backed Claude model
 * names must return Anthropic's model shape rather than the list shape.
 */
export function toAnthropicModelInfo(model, requestedId) {
  const id = String(requestedId || model?.id || "").trim();
  const displayName = String(model?.name || id)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());

  return {
    id,
    type: "model",
    display_name: displayName,
    created_at: "2024-01-01T00:00:00Z",
  };
}
