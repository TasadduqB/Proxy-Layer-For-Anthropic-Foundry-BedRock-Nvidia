import {
  getSupportedVoiceProviders,
  getVoiceCatalog,
  toOpenAiVoiceList,
  VoiceCatalogError,
} from "@/lib/tts/voiceCatalog";

const CORS_HEADERS = { "Access-Control-Allow-Origin": "*" };

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      ...CORS_HEADERS,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, X-API-Key",
    },
  });
}

// GET /v1/audio/voices?provider={p}[&lang=xx]
// Returns an OpenAI-style list whose model values are ready for /v1/audio/speech.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider");
    const language = searchParams.get("lang");
    const supportedProviders = getSupportedVoiceProviders();

    if (!provider || !supportedProviders.includes(provider)) {
      return Response.json(
        {
          error: {
            message: `provider must be one of: ${supportedProviders.join(", ")}`,
            type: "invalid_request_error",
          },
        },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    const catalog = await getVoiceCatalog(provider);
    const data = toOpenAiVoiceList(provider, catalog, language);

    return Response.json(
      { object: "list", data },
      {
        headers: {
          ...CORS_HEADERS,
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    const status = error instanceof VoiceCatalogError ? error.status : 502;
    return Response.json(
      {
        error: {
          message: error?.message || "Failed to fetch voices",
          type: status === 400 ? "invalid_request_error" : "server_error",
        },
      },
      { status, headers: CORS_HEADERS },
    );
  }
}
