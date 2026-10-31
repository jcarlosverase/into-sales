import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { apiError, withAuth } from "@/lib/api";
import { getEnv } from "@/lib/env";
import {
  channelDisabledResponse,
  isChannelEnabled,
} from "@/server/channels/enabled";
import {
  authorizeUrl,
  instagramOAuthConfig,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_MAX_AGE,
} from "@/server/instagram/oauth";

export const dynamic = "force-dynamic";

/**
 * Spec 1017 — Ida del «Conectar con Instagram»: manda al inicio de sesión de
 * Instagram con un `state` aleatorio que la vuelta comprueba contra la cookie.
 * Solo el propietario, como guardar el token a mano.
 */
export const GET = withAuth(async (session) => {
  if (!isChannelEnabled("instagram")) return channelDisabledResponse();
  if (session.role !== "owner") {
    return apiError(403, "forbidden", "Solo el propietario puede conectar Instagram");
  }
  const config = instagramOAuthConfig();
  if (!config) {
    return apiError(
      409,
      "not_configured",
      "Falta INSTAGRAM_APP_ID o INSTAGRAM_APP_SECRET en la instancia"
    );
  }

  const state = randomBytes(24).toString("hex");
  const res = NextResponse.redirect(authorizeUrl(config, state), 302);
  res.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: getEnv().APP_BASE_URL.startsWith("https://"),
    path: "/api/settings/instagram/oauth",
    maxAge: OAUTH_STATE_MAX_AGE,
  });
  return res;
});
