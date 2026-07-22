import { NextResponse } from "next/server";
import { getNvidiaCatalogModels } from "@/lib/nvidiaCatalog";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const models = await getNvidiaCatalogModels();
    return NextResponse.json({
      provider: "nvidia",
      models: models.map((id) => ({ id, name: id })),
      count: models.length,
      source: "live",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to fetch NVIDIA model catalog" },
      { status: 502 },
    );
  }
}
