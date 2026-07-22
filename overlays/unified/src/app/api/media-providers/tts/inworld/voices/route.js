import {
  filterVoiceCatalog,
  getVoiceCatalog,
  VoiceCatalogError,
} from "@/lib/tts/voiceCatalog";
import { NextResponse } from "next/server";

export async function GET(request) {
  try {
    const language = new URL(request.url).searchParams.get("lang");
    const catalog = filterVoiceCatalog(
      await getVoiceCatalog("inworld"),
      language,
    );
    return NextResponse.json(
      language
        ? { voices: catalog.voices }
        : { languages: catalog.languages, byLang: catalog.byLang },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status = error instanceof VoiceCatalogError ? error.status : 502;
    return NextResponse.json(
      { error: error?.message || "Failed to fetch voices" },
      { status },
    );
  }
}
