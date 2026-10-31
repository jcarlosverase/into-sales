import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { MetaApiError } from "@/lib/meta/client";
import {
  channelDisabledResponse,
  isChannelEnabled,
} from "@/server/channels/enabled";
import {
  getInstagramCredentialsByOrg,
  saveInstagramCredentials,
} from "@/server/instagram/credentials";
import {
  connectWithCode,
  instagramOAuthConfig,
  OAUTH_STATE_COOKIE,
  subscribeAccountToWebhook,
} from "@/server/instagram/oauth";

export const dynamic = "force-dynamic";

/** Resultados que la pantalla sabe contar (`?ig=` en Ajustes → Instagram). */
export type OAuthOutcome =
  | "connected"
  | "connected_no_webhook"
  | "denied"
  | "bad_state"
  | "not_configured"
  | "forbidden"
  | "meta_error"
  | "meta_unavailable";

/**
 * Spec 1017 — Vuelta del «Conectar con Instagram». Comprueba el `state`,
 * cambia el código por un token de larga duración, guarda la cuenta y la
 * suscribe al webhook. Siempre termina en Ajustes → Instagram con `?ig=` y
 * nunca con el código ni el token en la URL.
 */
export const GET = withAuth(async (session, req: Request) => {
  if (!isChannelEnabled("instagram")) return channelDisabledResponse();
  const url = new URL(req.url);
  const store = await cookies();
  const expected = store.get(OAUTH_STATE_COOKIE)?.value ?? "";

  const done = (outcome: OAuthOutcome) => {
    const base = getEnv().APP_BASE_URL.replace(/\/$/, "");
    const res = NextResponse.redirect(`${base}/settings/instagram?ig=${outcome}`, 302);
    res.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/api/settings/instagram/oauth", maxAge: 0 });
    return res;
  };

  if (session.role !== "owner") return done("forbidden");
  const config = instagramOAuthConfig();
  if (!config) return done("not_configured");
  if (url.searchParams.get("error")) return done("denied");
  if (!sameState(url.searchParams.get("state"), expected)) return done("bad_state");
  const code = url.searchParams.get("code");
  if (!code) return done("denied");

  let account;
  try {
    account = await connectWithCode(config, code);
  } catch (err) {
    if (err instanceof MetaApiError) {
      console.warn(
        `[ig-oauth] Instagram rechazó la conexión: ${err.status} ${err.code ?? ""} ${err.message}`
      );
      return done(err.status === 0 || err.status >= 500 ? "meta_unavailable" : "meta_error");
    }
    throw err;
  }

  const previous = await getInstagramCredentialsByOrg(session.organizationId);
  await saveInstagramCredentials({
    organizationId: session.organizationId,
    source: "meta",
    igUserId: account.igUserId,
    accountRef: null,
    username: account.username,
    token: account.token,
    webhookSecret: previous?.source === "meta" ? previous.webhookSecret : null,
  });

  const subscribed = await subscribeAccountToWebhook(account.token);
  return done(subscribed ? "connected" : "connected_no_webhook");
});

function sameState(got: string | null, expected: string): boolean {
  if (!got || !expected || got.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}
