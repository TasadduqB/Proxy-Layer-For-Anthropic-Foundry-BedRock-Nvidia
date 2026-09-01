export default {
  id: "tokenrouter",
  priority: 15,
  hasFree: true,
  alias: "tokenrouter",
  display: {
    name: "TokenRouter",
    icon: "route",
    color: "#6366F1",
    textIcon: "TR",
    notice: {
      text: "Add one connection per API key. Each account is routed and rate-limited independently; free compute stability and concurrency are not guaranteed.",
    },
  },
  category: "freeTier",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.tokenrouter.com/v1/chat/completions",
    quirks: {
      strictAssistantMessages: true,
    },
  },
  models: [
    { id: "moonshotai/kimi-k3-free", name: "Kimi K3 Free" },
  ],
  serviceKinds: ["llm"],
};
