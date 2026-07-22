import { NextResponse } from "next/server";
import { generatePKCE } from "@/lib/oauth/utils/pkce";
import { KiroService } from "@/lib/oauth/services/kiro";
import { registerAuthorizationSession } from "@/lib/oauth/authorizationSessions";

const KIRO_SOCIAL_REDIRECT_URI = "kiro://kiro.kiroAgent/authenticate-success";

/**
 * GET /api/oauth/kiro/social-authorize
 * Generate Google/GitHub social login URL for manual callback flow.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider");

    if (!provider || !["google", "github"].includes(provider)) {
      return NextResponse.json(
        { error: "Invalid provider. Use 'google' or 'github'" },
        { status: 400 }
      );
    }

    const { codeVerifier, codeChallenge, state } = generatePKCE();
    const kiroService = new KiroService();
    const authUrl = kiroService.buildSocialLoginUrl(provider, codeChallenge, state);

    registerAuthorizationSession(`kiro-social:${provider}`, {
      state,
      codeVerifier,
      redirectUri: KIRO_SOCIAL_REDIRECT_URI,
    });

    return NextResponse.json({
      authUrl,
      state,
      codeVerifier,
      codeChallenge,
      provider,
    });
  } catch (error) {
    console.log("Kiro social authorize error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
