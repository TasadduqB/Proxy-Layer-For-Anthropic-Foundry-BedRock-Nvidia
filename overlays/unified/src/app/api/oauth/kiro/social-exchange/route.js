import { NextResponse } from "next/server";
import { KiroService } from "@/lib/oauth/services/kiro";
import { createProviderConnection } from "@/models";
import { consumeAuthorizationSession } from "@/lib/oauth/authorizationSessions";

const KIRO_SOCIAL_REDIRECT_URI = "kiro://kiro.kiroAgent/authenticate-success";

/**
 * POST /api/oauth/kiro/social-exchange
 * Exchange a Google/GitHub social authorization code for Kiro tokens.
 */
export async function POST(request) {
  try {
    const { code, codeVerifier, provider, state } = await request.json();

    if (!code || !codeVerifier) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }
    if (!provider || !["google", "github"].includes(provider)) {
      return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
    }

    const authorizationSession = consumeAuthorizationSession(`kiro-social:${provider}`, {
      state,
      codeVerifier,
      redirectUri: KIRO_SOCIAL_REDIRECT_URI,
    });
    if (!authorizationSession.ok) {
      return NextResponse.json({ error: authorizationSession.error }, { status: 400 });
    }

    const kiroService = new KiroService();
    const tokenData = await kiroService.exchangeSocialCode(code, codeVerifier);
    if (typeof tokenData?.accessToken !== "string" || !tokenData.accessToken.trim()) {
      throw new Error("Kiro social token exchange returned no access token");
    }

    const email = kiroService.extractEmailFromJWT(tokenData.accessToken);
    const expiresIn = Number(tokenData.expiresIn);
    const connection = await createProviderConnection({
      provider: "kiro",
      authType: "oauth",
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      expiresAt: new Date(
        Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000
      ).toISOString(),
      email: email || null,
      providerSpecificData: {
        profileArn: tokenData.profileArn,
        authMethod: provider,
        provider: provider.charAt(0).toUpperCase() + provider.slice(1),
      },
      testStatus: "active",
    });

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
        email: connection.email,
      },
    });
  } catch (error) {
    console.log("Kiro social exchange error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
