// Free OpenCode models that don't use the "-free" id suffix.
const KNOWN_FREE_OPENCODE_MODELS = new Set(["big-pickle"]);

function isZeroPrice(value) {
  if (value === 0 || value === "0") return true;
  if (typeof value !== "string" || !value.trim()) return false;
  return Number(value) === 0;
}

export const FILTERS = {
  "openrouter-free": (models) =>
    (Array.isArray(models) ? models : [])
      .filter((model) => (
        isZeroPrice(model?.pricing?.prompt)
        && isZeroPrice(model?.pricing?.completion)
      ))
      .map((model) => ({
        id: model.id,
        name: model.name || model.id,
        contextLength: model.context_length,
      }))
      .filter((model) => typeof model.id === "string" && model.id.trim())
      .sort((a, b) => (
        Number(b.contextLength || 0) - Number(a.contextLength || 0)
        || a.id.localeCompare(b.id)
      )),

  "opencode-free": (models) =>
    (Array.isArray(models) ? models : [])
      .filter((model) => (
        model?.id?.endsWith("-free")
        || KNOWN_FREE_OPENCODE_MODELS.has(model?.id)
      ))
      .map((model) => ({ id: model.id, name: model.name || model.id })),

  // models.dev returns a large catalog; keep only mimo models.
  "mimo-free": (models) =>
    (Array.isArray(models) ? models : [])
      .filter((model) => (
        model.id?.startsWith("mimo")
        || model.name?.toLowerCase().includes("mimo")
      ))
      .map((model) => ({ id: model.id, name: model.name || model.id })),
};
