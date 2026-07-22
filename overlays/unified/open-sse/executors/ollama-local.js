import { DefaultExecutor } from "./default.js";
import { resolveOllamaLocalHost } from "../config/providers.js";

export class OllamaLocalExecutor extends DefaultExecutor {
  constructor() {
    super("ollama-local");
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    return `${resolveOllamaLocalHost(credentials)}/api/chat`;
  }

  // Local Ollama is intentionally credential-free. Do not emit the default
  // executor's synthetic `Authorization: Bearer undefined` header.
  buildHeaders(credentials, stream = true) {
    return {
      "Content-Type": "application/json",
      Accept: stream ? "application/x-ndjson" : "application/json",
    };
  }
}

export default OllamaLocalExecutor;
