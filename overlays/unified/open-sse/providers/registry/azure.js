export default {
  id: "azure",
  priority: 40,
  alias: "azure",
  display: {
    name: "Azure AI Foundry",
    icon: "cloud",
    color: "#0078D4",
    textIcon: "AZ",
    website: "https://ai.azure.com/",
    notice: {
      text: "Discovers Azure OpenAI account models, Foundry project deployments, and serverless endpoint models from the connected endpoint.",
      apiKeyUrl: "https://ai.azure.com/",
    },
  },
  category: "apikey",
  hasProviderSpecificData: true,
  passthroughModels: true,
  transport: {
    baseUrl: "",
    headers: {},
  },
  // Live discovery is authoritative. These common deployment names keep the
  // provider useful offline and configured deployment names are merged in.
  models: [
    { id: "gpt-5", name: "GPT-5" },
    { id: "gpt-5-mini", name: "GPT-5 mini" },
    { id: "gpt-4.1", name: "GPT-4.1" },
    { id: "gpt-4.1-mini", name: "GPT-4.1 mini" },
    { id: "gpt-4o", name: "GPT-4o" },
    { id: "gpt-4o-mini", name: "GPT-4o mini" },
    { id: "o3", name: "o3" },
    { id: "o3-mini", name: "o3-mini" },
    { id: "o4-mini", name: "o4-mini" },
    { id: "Phi-4", name: "Phi-4" },
    { id: "DeepSeek-R1", name: "DeepSeek-R1" },
  ],
  serviceKinds: ["llm", "imageToText", "embedding", "image", "tts"],
};
