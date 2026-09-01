export default {
  id: "opencode",
  priority: 40,
  hasFree: true,
  alias: "oc",
  uiAlias: "oc",
  display: {
    name: "OpenCode Free",
    icon: "terminal",
    color: "#E87040",
    textIcon: "OC",
  },
  category: "free",
  noAuth: true,
  transport: {
    baseUrl: "https://opencode.ai",
    headers: {
      "x-opencode-client": "desktop",
    },
    noAuth: true,
    quirks: {
      // Zen rejects reasoning-only assistant history even though several other
      // OpenAI-compatible endpoints accept it as an extension. Keep
      // reasoning_content on real tool-call turns, however: Zen requires that
      // field to be replayed while continuing a thinking-mode tool loop.
      requiresAssistantContentOrToolCalls: true,
      // A Claude combo transcript mixes tool turns produced by unrelated
      // providers. Partial reasoning metadata makes Zen interpret the history
      // as an incomplete thinking-mode replay. Remove that non-portable private
      // metadata while retaining the actual tool calls and results.
      stripAssistantReasoningHistory: true,
    },
  },
  models: [],
  modelsFetcher: { url: "https://opencode.ai/zen/v1/models", type: "opencode-free" },
  passthroughModels: true,
};
