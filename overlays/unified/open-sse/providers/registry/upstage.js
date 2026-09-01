export default {
  id: "upstage",
  priority: 200,
  hasFree: true,
  alias: "upstage",
  display: {
    name: "Upstage Solar",
    icon: "bolt",
    color: "#7c3aed",
    textIcon: "UP",
    notice: {
      text: "Free tier: one-time signup credit (~$10), no card required.",
    },
  },
  category: "freeTier",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.upstage.ai/v1/chat/completions",
    validateUrl: "https://api.upstage.ai/v1/models",
  },
  models: [
    { id: "solar-pro2", name: "Solar Pro 2" },
    { id: "solar-pro2-251215", name: "Solar Pro 2 (dated)" },
  ],
  serviceKinds: ["llm"],
};
