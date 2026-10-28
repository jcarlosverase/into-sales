import { graphRequest, MetaApiError } from "@/lib/meta/client";

/**
 * Campos de la página que el CRM necesita. `messages` es lo único que se
 * ingiere; los echos, acuses y postbacks se descartan en la ingesta.
 */
export const MESSENGER_FIELDS = ["messages"] as const;

export type PageSubscription =
  | { ok: true }
  | {
      ok: false;
      code: "missing_permission" | "invalid_token" | "meta_unavailable" | "meta_error";
      message: string;
    };

/**
 * Spec 1010: suscribe la página a la app del token, para que Meta mande sus
 * mensajes al webhook de Messenger.
 *
 * Configurar el webhook de la app (objeto `page`, campo `messages`) no basta:
 * Meta solo entrega los eventos de las páginas SUSCRITAS a la app
 * (`POST /{page}/subscribed_apps`). Antes el CRM guardaba el token y le dejaba
 * ese paso al dueño en una línea de ayuda; si no lo hacía, el canal salía
 * «Messenger activo» y no llegaba ningún mensaje.
 *
 * Se hace con el token de la PÁGINA, que necesita `pages_manage_metadata`
 * además de `pages_messaging`. Jamás lanza por una respuesta de Meta: guardar
 * la conexión no puede fallar por esto.
 */
export async function subscribePageToApp(
  pageId: string,
  token: string
): Promise<PageSubscription> {
  try {
    await graphRequest(`${pageId}/subscribed_apps`, {
      method: "POST",
      token,
      body: { subscribed_fields: MESSENGER_FIELDS.join(",") },
    });
    return { ok: true };
  } catch (err) {
    if (!(err instanceof MetaApiError)) throw err;
    if (err.isAuthError) {
      return { ok: false, code: "invalid_token", message: "El token de la página no es válido o expiró." };
    }
    if (err.status === 0 || err.status >= 500) {
      return {
        ok: false,
        code: "meta_unavailable",
        message: "Meta no está disponible en este momento; vuelve a guardar en unos minutos.",
      };
    }
    // 200 / 10 / 210 / 230: permisos. Lo típico es un token sin
    // pages_manage_metadata, que es el que permite suscribir la página.
    if ([10, 200, 210, 230].includes(err.code ?? -1) || err.status === 403) {
      return {
        ok: false,
        code: "missing_permission",
        message:
          "El token no puede suscribir la página a tu app: genéralo con los permisos pages_messaging y pages_manage_metadata.",
      };
    }
    return { ok: false, code: "meta_error", message: `Meta no suscribió la página: ${err.message}` };
  }
}
