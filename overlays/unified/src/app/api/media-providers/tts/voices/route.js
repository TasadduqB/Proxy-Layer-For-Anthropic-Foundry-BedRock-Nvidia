import {
  filterVoiceCatalog,
  getSupportedVoiceProviders,
  getVoiceCatalog,
  VoiceCatalogError,
} from "@/lib/tts/voiceCatalog";
import { NextResponse } from "next/server";

/** Shared dashboard voice catalogue for every provider with list support. */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider") || "edge-tts";
    const language = searchParams.get("lang");
    if (!getSupportedVoiceProviders().includes(provider)) {
      return NextResponse.json(
        { error: `Provider '${provider}' does not support voice listing` },
        { status: 400 },
      );
    }

    const catalog = filterVoiceCatalog(
      await getVoiceCatalog(provider),
      language,
    );
    return NextResponse.json(catalog, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const status = error instanceof VoiceCatalogError ? error.status : 502;
    return NextResponse.json(
      { error: error?.message || "Failed to fetch voices" },
      { status },
    );
  }
}
