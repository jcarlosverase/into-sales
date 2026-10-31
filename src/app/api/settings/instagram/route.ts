import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  getInstagramCredentialsByOrg,
  saveInstagramCredentials,
  tokenLast4,
} from "@/server/instagram/credentials";
import {
  channelDisabledResponse,
  isChannelEnabled,
} from "@/server/channels/enabled";
import { ensureWebhookForOrg } from "@/server/zernio/connections";
import { accountHealth, zernioAccountName } from "@/server/zernio/accounts";
import { resolveZernioAccount } from "@/server/zernio/save-connection";
import {
  fetchProfile,
  instagramOAuthConfig,
  instagramRedirectUri,
} from "@/server/instagram/oauth";

export const dynamic = "force-dynamic";

/**
 * 014 — Estado de la conexión de Instagram (el token nunca sale entero).
 *
 * Spec 1017: también dice si «Conectar con Instagram» está disponible y su URL
 * de vuelta, y trae la foto de perfil de la cuenta conectada por Meta. La foto
 * se pide en vivo porque su URL caduca; si no llega, la pantalla enseña solo
 * el @usuario.
 */
export const GET = withAuth(async (session) => {
  if (!isChannelEnabled("instagram")) return channelDisabledResponse();
  const oauth = {
    available: instagramOAuthConfig() !== null,
    redirectUri: instagramRedirectUri(),
  };
  const creds = await getInstagramCredentialsByOrg(session.organizationId);
  if (!creds) return Response.json({ connection: null, oauth });
  const profile =
    creds.source === "meta" && creds.status === "connected"
      ? await withTimeout(fetchProfile(creds.token), 4000).catch(() => null)
      : null;
  return Response.json({
    connection: {
      source: creds.source,
      igUserId: creds.igUserId,
      accountRef: creds.accountRef,
      username: profile?.username ?? creds.username,
      profilePictureUrl: profile?.pictureUrl ?? null,
      status: creds.status,
      tokenLast4: tokenLast4(creds.token),
    },
    oauth,
  });
});

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

const putSchema = z.object({
  source: z.enum(["zernio", "meta"]),
  /** Con Meta, obligatorio. Con Zernio sale de la cuenta (023). */
  igUserId: z.string().trim().min(1).nullish(),
  /** Con Zernio: opcional si la llave tiene una sola cuenta de Instagram. */
  accountRef: z.string().trim().min(1).nullish(),
  username: z.string().trim().nullish(),
  token: z.string().trim().min(1),
  webhookSecret: z.string().trim().min(1).nullish(),
});

/**
 * Guarda la conexión validando ANTES contra la plataforma, igual que el
 * wizard de WhatsApp: un token que no sirve no llega a la base. Solo el
 * propietario de la organización puede hacerlo (023: esta ruta no lo
 * revisaba; Messenger y TikTok sí).
 */
export const PUT = withAuth(async (session, req: Request) => {
  if (!isChannelEnabled("instagram")) return channelDisabledResponse();
  if (session.role !== "owner") {
    return apiError(403, "forbidden", "Solo el propietario puede conectar Instagram");
  }
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;
  const data = body.data;

  const previous = await getInstagramCredentialsByOrg(session.organizationId);
  // Sin secreto nuevo se conserva el que había: reconectar no debe apagar la
  // verificación de firma.
  const webhookSecret =
    data.webhookSecret ??
    (previous?.source === data.source ? previous.webhookSecret : null) ??
    null;

  if (data.source === "zernio") {
    // 023: la cuenta se resuelve contra Zernio, no se guarda a ciegas.
    const account = await resolveZernioAccount(data.token, data.accountRef, "instagram");
    if (!account.ok) return account.response;
    const username = account.account.username?.replace(/^@/, "") || data.username || null;

    await saveInstagramCredentials({
      organizationId: session.organizationId,
      source: "zernio",
      igUserId: account.account.platformUserId || data.igUserId || account.account._id,
      accountRef: account.account._id,
      username,
      token: data.token,
      webhookSecret,
    });
    const webhook = await ensureWebhookForOrg(session.organizationId, {
      secret: data.webhookSecret,
    });
    return Response.json({
      ok: true,
      username,
      accountRef: account.account._id,
      accountName: zernioAccountName(account.account),
      health: accountHealth(account.account, "instagram"),
      webhook,
    });
  }

  // Spec 1011: el ID es opcional; si no viene, se toma del token.
  const check = await verify({ token: data.token, igUserId: data.igUserId ?? null });
  if (!check.ok) {
    return apiError(check.status, check.code, check.message);
  }

  await saveInstagramCredentials({
    organizationId: session.organizationId,
    source: "meta",
    igUserId: check.igUserId,
    accountRef: null,
    username: check.username ?? data.username ?? null,
    token: data.token,
    webhookSecret,
  });

  return Response.json({ ok: true, username: check.username ?? null });
});

type Check =
  | { ok: true; igUserId: string; username: string | null }
  | { ok: false; status: number; code: string; message: string };

/**
 * Fuente Meta: el token tiene que ser de ESA cuenta de Instagram.
 *
 * Spec 1011: con el inicio de sesión de Instagram, `/me` devuelve dos IDs.
 * `id` es el de la persona dentro de la app (app-scoped) y `user_id` es el de
 * la cuenta profesional (IG_ID): el que llega en `entry[].id` de cada webhook
 * y con el que se envía. Antes se comparaba y se guardaba `id`, así que quien
 * pegaba el IG_ID del panel recibía «el IG_ID del token es…» y quien pegaba
 * ese otro número quedaba conectado sin que le llegara ningún mensaje.
 * `id` solo se usa si Meta no manda `user_id`.
 */
async function verify(data: { token: string; igUserId: string | null }): Promise<Check> {
  const url = `${process.env.IG_GRAPH_BASE_URL ?? "https://graph.instagram.com"}/${
    process.env.META_GRAPH_API_VERSION ?? "v25.0"
  }/me?fields=user_id,username`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${data.token}` },
    });
  } catch {
    return {
      ok: false,
      status: 503,
      code: "platform_unavailable",
      message: "No se pudo contactar la plataforma; intenta de nuevo",
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      status: 422,
      code: "invalid_token",
      message: "El token de Instagram no es válido o no tiene permiso de mensajes",
    };
  }

  const json = (await res.json().catch(() => null)) as {
    id?: string | number;
    user_id?: string | number;
    username?: string;
  } | null;
  const tokenIgId = String(json?.user_id ?? json?.id ?? "") || null;
  const igUserId = tokenIgId ?? data.igUserId;
  if (!igUserId) {
    return {
      ok: false,
      status: 422,
      code: "invalid_body",
      message: "Meta no devolvió el ID de la cuenta: pégalo junto al token",
    };
  }
  // Se acepta también el `id` app-scoped que pedía la versión anterior: es
  // la misma cuenta, y se guarda igual el IG_ID.
  const appScopedId = json?.id === undefined ? null : String(json.id);
  if (data.igUserId && tokenIgId && data.igUserId !== tokenIgId && data.igUserId !== appScopedId) {
    return {
      ok: false,
      status: 422,
      code: "id_mismatch",
      message: `El token es de la cuenta ${tokenIgId}, no de ${data.igUserId}`,
    };
  }
  return { ok: true, igUserId, username: json?.username ?? null };
}
