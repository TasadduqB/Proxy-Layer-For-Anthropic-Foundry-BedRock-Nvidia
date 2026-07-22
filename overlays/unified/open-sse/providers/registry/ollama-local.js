export default {
  id: "ollama-local",
  priority: 50,
  hasFree: true,
  alias: "ollama-local",
  display: {
    name: "Ollama Local",
    icon: "cloud",
    color: "#ffffffff",
    textIcon: "OL",
    website: "https://ollama.com",
  },
  category: "apikey",
  noAuth: true,
  transport: {
    baseUrl: "http://localhost:11434/api/chat",
    format: "ollama",
    noAuth: true,
  },
  serviceKinds: ["llm"],
};
