import { getEnv } from "@/lib/env";
import { MetaApiError } from "@/lib/meta/client";

/**
 * Spec 1017 — «Conectar con Instagram»: el inicio de sesión empresarial de
 * Instagram (Instagram API with Instagram Login).
 *
 * Usa el ID y la clave de la app de INSTAGRAM («IntoSales - IG»), no los de la
 * app de Meta: son otra identidad, con su propio ID. Los hosts se pueden
 * apuntar a un mock con `IG_OAUTH_BASE_URL`, `IG_API_BASE_URL` e
 * `IG_GRAPH_BASE_URL`, como el resto del canal.
 *
 * Nada de aquí escribe un código ni un token en el log.
 */

const OAUTH_BASE = () => process.env.IG_OAUTH_BASE_URL ?? "https://www.instagram.com";
const API_BASE = () => process.env.IG_API_BASE_URL ?? "https://api.instagram.com";
const GRAPH_BASE = () => process.env.IG_GRAPH_BASE_URL ?? "https://graph.instagram.com";
const GRAPH_VERSION = () => process.env.META_GRAPH_API_VERSION ?? "v25.0";

/** Lo que la cuenta del negocio le concede al CRM. */
export const INSTAGRAM_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
] as const;

/** Cookie con el `state` del viaje de ida, para comprobarlo a la vuelta. */
export const OAUTH_STATE_COOKIE = "intosales-ig-oauth-state";
export const OAUTH_STATE_MAX_AGE = 10 * 60;

export type InstagramOAuthConfig = {
  appId: string;
  appSecret: string;
  redirectUri: string;
};

/** La configuración, o null si falta el ID o la clave de la app de Instagram. */
export function instagramOAuthConfig(): InstagramOAuthConfig | null {
  const env = getEnv();
  const appId = env.INSTAGRAM_APP_ID?.trim();
  const appSecret = env.INSTAGRAM_APP_SECRET?.trim();
  if (!appId || !appSecret) return null;
  return { appId, appSecret, redirectUri: instagramRedirectUri() };
}

/** La URL de vuelta, la que se registra en Meta (paso 4 del caso de uso). */
export function instagramRedirectUri(): string {
  const base = getEnv().APP_BASE_URL.replace(/\/$/, "");
  return `${base}/api/settings/instagram/oauth/callback`;
}

export function authorizeUrl(config: InstagramOAuthConfig, state: string): string {
  const url = new URL("/oauth/authorize", OAUTH_BASE());
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", INSTAGRAM_SCOPES.join(","));
  url.searchParams.set("state", state);
  // Sin esto, quien ya conectó una cuenta no puede elegir otra.
  url.searchParams.set("force_reauth", "true");
  return url.toString();
}

export type ConnectedAccount = {
  igUserId: string;
  username: string | null;
  token: string;
};

/**
 * Código de la vuelta → token de larga duración → la cuenta. Lanza
 * MetaApiError con el motivo de Meta si algún paso falla.
 */
export async function connectWithCode(
  config: InstagramOAuthConfig,
  rawCode: string
): Promise<ConnectedAccount> {
  // Instagram a veces pega «#_» al final del código.
  const code = rawCode.replace(/#_$/, "");

  const short = (await fetchJson(`${API_BASE()}/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.appId,
      client_secret: config.appSecret,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri,
      code,
    }).toString(),
  })) as ShortTokenResponse;
  // Meta responde con la forma plana o envuelta en `data` según la versión.
  const first = Array.isArray(short?.data) ? short.data[0] : short;
  const shortToken = first?.access_token;
  if (!shortToken) throw new MetaApiError("Instagram no devolvió un token", { status: 502 });

  const longUrl = new URL("/access_token", GRAPH_BASE());
  longUrl.searchParams.set("grant_type", "ig_exchange_token");
  longUrl.searchParams.set("client_secret", config.appSecret);
  longUrl.searchParams.set("access_token", shortToken);
  const long = (await fetchJson(longUrl.toString(), { method: "GET" })) as {
    access_token?: string;
  } | null;
  const token = long?.access_token;
  if (!token) throw new MetaApiError("Instagram no devolvió el token de larga duración", { status: 502 });

  const me = await fetchProfile(token);
  const igUserId = me.igUserId ?? (first?.user_id != null ? String(first.user_id) : null);
  if (!igUserId) throw new MetaApiError("Instagram no devolvió el ID de la cuenta", { status: 502 });
  return { igUserId, username: me.username, token };
}

type ShortTokenResponse =
  | {
      access_token?: string;
      user_id?: string | number;
      data?: Array<{ access_token?: string; user_id?: string | number }>;
    }
  | null;

export type InstagramProfile = {
  igUserId: string | null;
  username: string | null;
  pictureUrl: string | null;
};

/** La cuenta del token: IG_ID (`user_id`), @usuario y foto. */
export async function fetchProfile(token: string): Promise<InstagramProfile> {
  const res = (await fetchJson(
    `${GRAPH_BASE()}/${GRAPH_VERSION()}/me?fields=user_id,username,profile_picture_url`,
    { method: "GET", headers: { Authorization: `Bearer ${token}` } }
  )) as {
    user_id?: string | number;
    id?: string | number;
    username?: string;
    profile_picture_url?: string;
  } | null;
  const id = res?.user_id ?? res?.id;
  return {
    igUserId: id == null ? null : String(id),
    username: res?.username?.replace(/^@/, "").trim() || null,
    pictureUrl: res?.profile_picture_url || null,
  };
}

/**
 * Suscribe la cuenta al webhook de la app (el interruptor «Suscripción a
 * webhook» del panel de Meta). Nunca lanza: true si Meta lo aceptó.
 */
export async function subscribeAccountToWebhook(token: string): Promise<boolean> {
  try {
    const res = (await fetchJson(
      `${GRAPH_BASE()}/${GRAPH_VERSION()}/me/subscribed_apps?subscribed_fields=messages`,
      { method: "POST", headers: { Authorization: `Bearer ${token}` } }
    )) as { success?: boolean } | null;
    return res?.success !== false;
  } catch {
    return false;
  }
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, cache: "no-store" });
  } catch (cause) {
    throw new MetaApiError("No se pudo contactar a Instagram", { status: 0, details: cause });
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // respuesta no-JSON
  }
  if (!res.ok) {
    const err = json as
      | { error?: { message?: string; code?: number } | string; error_message?: string; code?: number }
      | null;
    const message =
      typeof err?.error === "string"
        ? err.error_message ?? err.error
        : err?.error?.message ?? err?.error_message ?? `HTTP ${res.status}`;
    const code = typeof err?.error === "object" ? err.error?.code ?? null : err?.code ?? null;
    throw new MetaApiError(message, { status: res.status, code });
  }
  return json;
}
