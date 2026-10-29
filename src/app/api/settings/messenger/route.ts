import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { graphRequest, MetaApiError } from "@/lib/meta/client";
import {
  getMessengerCredentialsByOrg,
  saveMessengerCredentials,
  tokenLast4,
} from "@/server/messenger/credentials";
import {
  channelDisabledResponse,
  isChannelEnabled,
} from "@/server/channels/enabled";
import { ensureWebhookForOrg } from "@/server/zernio/connections";
import { accountHealth, zernioAccountName } from "@/server/zernio/accounts";
import { resolveZernioAccount } from "@/server/zernio/save-connection";
import { subscribePageToApp } from "@/server/messenger/subscribe";

export const dynamic = "force-dynamic";

/** 017 — Estado de la conexión de Messenger (el token nunca sale entero). */
export const GET = withAuth(async (session) => {
  if (!isChannelEnabled("messenger")) return channelDisabledResponse();
  const creds = await getMessengerCredentialsByOrg(session.organizationId);
  if (!creds) return Response.json({ connection: null });
  return Response.json({
    connection: {
      source: creds.source,
      pageId: creds.pageId,
      pageName: creds.pageName,
      accountRef: creds.accountRef,
      status: creds.status,
      tokenLast4: tokenLast4(creds.token),
    },
  });
});

const putSchema = z.object({
  source: z.enum(["zernio", "meta"]).default("meta"),
  pageId: z.string().trim().min(1).nullish(),
  accountRef: z.string().trim().min(1).nullish(),
  token: z.string().trim().min(1),
  webhookSecret: z.string().trim().min(1).nullish(),
});

/**
 * Guarda la conexión validando ANTES contra la plataforma, igual que el wizard
 * de WhatsApp: un token que no sirve no llega a la base. Solo el propietario
 * de la organización puede hacerlo.
 */
export const PUT = withAuth(async (session, req: Request) => {
  if (!isChannelEnabled("messenger")) return channelDisabledResponse();
  if (session.role !== "owner") {
    return apiError(403, "forbidden", "Solo el propietario puede conectar la página");
  }
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;
  // `.default()` deja el tipo opcional aunque Zod siempre lo rellene: se fija
  // aquí para que el resto del handler trabaje con un valor cerrado.
  const data = { ...body.data, source: body.data.source ?? "meta" };

  if (data.source === "meta" && !data.pageId) {
    return apiError(
      422,
      "invalid_body",
      "En modo Meta hace falta el ID de la página"
    );
  }

  const previous = await getMessengerCredentialsByOrg(session.organizationId);
  // Sin secreto nuevo se conserva el que había: reconectar no debe apagar la
  // verificación de firma.
  const webhookSecret =
    data.webhookSecret ??
    (previous?.source === data.source ? previous.webhookSecret : null) ??
    null;

  if (data.source === "zernio") {
    // 023: la cuenta se resuelve contra Zernio, no se guarda a ciegas. De ahí
    // salen también la página y su nombre.
    const account = await resolveZernioAccount(data.token, data.accountRef, "messenger");
    if (!account.ok) return account.response;
    const pageName = zernioAccountName(account.account);

    await saveMessengerCredentials({
      organizationId: session.organizationId,
      source: "zernio",
      pageId: account.account.metadata?.selectedPageId ?? data.pageId ?? null,
      pageName,
      accountRef: account.account._id,
      token: data.token,
      webhookSecret,
    });
    const webhook = await ensureWebhookForOrg(session.organizationId, {
      secret: data.webhookSecret,
    });
    return Response.json({
      ok: true,
      pageName,
      accountRef: account.account._id,
      accountName: pageName,
      health: accountHealth(account.account, "messenger"),
      webhook,
    });
  }

  const check = await verify(data);
  if (!check.ok) return apiError(check.status, check.code, check.message);

  // Spec 1016: si Meta no dejó leer `/me`, la suscripción de la página es la
  // prueba de que el token sirve para ESA página, y va antes de guardar: un
  // token que no puede ni suscribirla no llega a la base.
  let subscription = check.verified ? null : await subscribePageToApp(data.pageId!, data.token);
  if (subscription && !subscription.ok) {
    return apiError(
      subscription.code === "meta_unavailable" ? 503 : 422,
      "invalid_token",
      `No se pudo comprobar que el token sea de la página ${data.pageId}: ${subscription.message}`
    );
  }

  await saveMessengerCredentials({
    organizationId: session.organizationId,
    source: "meta",
    pageId: data.pageId ?? null,
    pageName: check.pageName,
    accountRef: null,
    token: data.token,
    webhookSecret,
  });

  // Spec 1010: sin la página suscrita a la app, Meta no entrega nada. Si
  // falla, la conexión ya está guardada (envía) y la pantalla dice qué falta.
  subscription ??= await subscribePageToApp(data.pageId!, data.token);

  return Response.json({ ok: true, pageName: check.pageName, subscription });
});

type Check =
  | {
      ok: true;
      pageName: string | null;
      /** false: Meta no dejó leer `/me` (spec 1016); lo confirma la suscripción. */
      verified: boolean;
    }
  | { ok: false; status: number; code: string; message: string };

type VerifyInput = Omit<z.infer<typeof putSchema>, "source"> & {
  source: "zernio" | "meta";
};

/**
 * Fuente Meta.
 *
 * Spec 1012: el token se valida con `GET /me?fields=id`. Con un token de
 * página, `/me` ES la página, así que su id tiene que ser el ID pegado: un
 * token de usuario o de otra página no pasa. Antes se pedía
 * `{pageId}?fields=id,name`, que (1) devolvía siempre el ID pedido, sin
 * comprobar de quién era el token, y (2) exige `pages_read_engagement` para
 * leer el nombre — un permiso que el caso de uso de Messenger no siempre da —,
 * así que un token de página correcto se rechazaba como «no válido».
 * El nombre se pide aparte y, si Meta no lo da, se guarda sin él.
 */
async function verify(data: VerifyInput): Promise<Check> {
  let tokenOwner: string | undefined;
  try {
    tokenOwner = (await graphRequest<{ id?: string }>("me?fields=id", { token: data.token })).id;
  } catch (err) {
    // Spec 1016: hay páginas en las que Meta exige `pages_read_engagement`
    // hasta para leer el id de `/me`, y el token del caso de uso de Messenger
    // no lo trae. Eso no dice que el token no sirva: se sigue sin poder
    // comprobar el dueño y lo confirma la suscripción de la página.
    if (isMissingReadPermission(err)) return { ok: true, pageName: null, verified: false };
    return translate(err, "El token de la página no es válido");
  }
  if (tokenOwner !== data.pageId) {
    return {
      ok: false,
      status: 422,
      code: "id_mismatch",
      message: `El token no es de la página ${data.pageId}${
        tokenOwner ? ` (es de ${tokenOwner}: un usuario u otra página)` : ""
      }. Genera el token junto a esa página en Messenger → Configuración de la API.`,
    };
  }

  let pageName: string | null = null;
  try {
    const res = await graphRequest<{ name?: string }>("me?fields=name", { token: data.token });
    pageName = res.name?.trim() || null;
  } catch {
    // Sin permiso para leer el nombre: la conexión sirve igual.
  }
  return { ok: true, pageName, verified: true };
}

/**
 * El error de permisos de lectura de Meta (código 100, 10 o 200 que pide
 * `pages_read_engagement` o una función de acceso público), distinto de un
 * token vencido o inválido (190 / 401).
 */
function isMissingReadPermission(err: unknown): boolean {
  if (!(err instanceof MetaApiError) || err.isAuthError) return false;
  if (err.status === 0 || err.status >= 500) return false;
  return (
    [10, 100, 200].includes(err.code ?? -1) &&
    /pages_read_engagement|Page Public (Content|Metadata) Access|missing permission/i.test(err.message)
  );
}

function translate(err: unknown, invalidMessage: string): Check {
  if (err instanceof MetaApiError) {
    if (err.status === 0 || err.status >= 500) {
      return {
        ok: false,
        status: 503,
        code: "platform_unavailable",
        message: "No se pudo contactar la plataforma; intenta de nuevo",
      };
    }
    // Meta's own reason (expired token, wrong app, a user token instead of
    // the page's…) is what tells the owner which of the cases it is. Meta's
    // error text never carries the token.
    return {
      ok: false,
      status: 422,
      code: "invalid_token",
      message: `${invalidMessage}. Meta dice: ${err.message}`,
    };
  }
  throw err;
}
