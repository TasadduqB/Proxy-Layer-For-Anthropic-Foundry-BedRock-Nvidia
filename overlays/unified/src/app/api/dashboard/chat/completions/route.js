import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";

let initialized = false;

async function ensureInitialized() {
  if (initialized) return;
  await initTranslators();
  initialized = true;
}

/**
 * Authenticated dashboard chat endpoint used by the Playground.
 * The deny-by-default dashboard guard authenticates this /api route before
 * execution; provider selection and streaming are delegated to the same
 * handler as the public OpenAI-compatible endpoint.
 */
export async function POST(request) {
  await ensureInitialized();
  return handleChat(request);
}
