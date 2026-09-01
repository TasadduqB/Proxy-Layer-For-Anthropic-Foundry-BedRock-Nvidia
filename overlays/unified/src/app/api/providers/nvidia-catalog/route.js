import { NextResponse } from "next/server";
import { getNvidiaCatalogModels, isNvidiaChatModelId } from "@/lib/nvidiaCatalog";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const models = await getNvidiaCatalogModels();
    // Exclude embedding/rerank/guard/TTS/etc. entries — this endpoint feeds
    // chat-model pickers (Combo editor, provider "Available Models"), and
    // those kinds are surfaced through their own dedicated config, not here.
    const chatModels = models.filter(isNvidiaChatModelId);
    return NextResponse.json({
      provider: "nvidia",
      models: chatModels.map((id) => ({ id, name: id })),
      count: chatModels.length,
      source: "live",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to fetch NVIDIA model catalog" },
      { status: 502 },
    );
  }
}
