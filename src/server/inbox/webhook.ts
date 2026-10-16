import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Autenticación en dos capas del webhook (contrato webhook.md / DV-VC-02).
 * Este módulo es puro (sin BD) para poder testearse unitariamente.
 */

/** Comparación timing-safe de strings de longitud arbitraria. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHmac("sha256", "cmp").update(a).digest();
  const hb = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Capa 1: el segmento de la ruta debe coincidir con el verify token. */
export function isValidWebhookToken(
  segment: string,
  verifyToken: string
): boolean {
  return verifyToken.length > 0 && safeEqual(segment, verifyToken);
}

/**
 * Capa 2 (opcional): firma HMAC-SHA256 de Meta sobre el body CRUDO.
 * Devuelve true si no hay secreto configurado (capa desactivada).
 */
export function isValidSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string | undefined
): boolean {
  if (!appSecret) return true;
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex");
  return safeEqual(signatureHeader.slice("sha256=".length), expected);
}

/**
 * A rejected signature used to be silent: Meta got its 401, retried for a
 * while and dropped the message, and the inbox simply stayed empty. The
 * usual cause is a META_APP_SECRET that is not the App Secret of the app that
 * sends the webhooks (copied from another app, or cut short). Say so in the
 * server log, at most once a minute so a burst of retries does not flood it.
 * The secret itself is never logged.
 */
let lastSignatureWarning = 0;
export function warnInvalidSignature(channel: string, hasSignature: boolean): void {
  const now = Date.now();
  if (now - lastSignatureWarning < 60_000) return;
  lastSignatureWarning = now;
  console.warn(
    hasSignature
      ? `[webhook ${channel}] Meta mandó un evento con una firma que no coincide con META_APP_SECRET y se descartó (401). Revisa que META_APP_SECRET sea el App Secret de la misma app de Meta (32 caracteres, en Configuración de la app → Básica) y reinicia la app.`
      : `[webhook ${channel}] llegó un evento sin firma y META_APP_SECRET está configurado: se descartó (401).`
  );
}

/* ---------- Tipos del payload de Meta (subconjunto soportado) ---------- */

/** Payload de un adjunto en un mensaje del webhook (008). */
export type WebhookMediaPayload = {
  id?: string;
  mime_type?: string;
  sha256?: string;
  caption?: string;
  /** Solo documentos. */
  filename?: string;
  /** Solo audio: true si es nota de voz. */
  voice?: boolean;
};

export type WebhookLocation = {
  latitude?: number;
  longitude?: number;
  name?: string;
  address?: string;
};

/**
 * 016 — Objeto `referral`: SOLO llega cuando el mensaje viene de un anuncio
 * Click-to-WhatsApp, y normalmente solo en el PRIMER mensaje de la
 * conversación. Su `ctwa_clid` es lo que permite devolverle a Meta el
 * desenlace de ese lead; el resto son datos del creativo.
 */
export type WebhookReferral = {
  source_url?: string;
  source_id?: string;
  source_type?: string;
  headline?: string;
  body?: string;
  media_type?: string;
  image_url?: string;
  video_url?: string;
  thumbnail_url?: string;
  ctwa_clid?: string;
};

/**
 * #78 — Respuesta a un botón de respuesta rápida de una PLANTILLA
 * (`type: "button"`): `text` es el rótulo que vio el cliente y `payload` el
 * que se definió al crear la plantilla (en la práctica, el mismo rótulo).
 */
export type WebhookButtonReply = {
  text?: string;
  payload?: string;
};

/**
 * #78 — Respuesta a un mensaje INTERACTIVO (`type: "interactive"`): un botón
 * (`button_reply`) o una fila de lista (`list_reply`). Meta pone en `type`
 * cuál de los dos viene.
 */
export type WebhookInteractiveReply = {
  type?: string;
  button_reply?: { id?: string; title?: string };
  list_reply?: { id?: string; title?: string; description?: string };
};

export type WebhookMessage = {
  /** Teléfono del remitente. OPCIONAL desde la migración de Meta a BSUID (003). */
  from?: string;
  /** Business-Scoped User ID del remitente cuando no hay teléfono (003). */
  from_user_id?: string;
  /** Destinatario — presente en echoes de coexistence (008): el wa_id del lead. */
  to?: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: WebhookMediaPayload;
  video?: WebhookMediaPayload;
  audio?: WebhookMediaPayload;
  document?: WebhookMediaPayload;
  sticker?: WebhookMediaPayload;
  location?: WebhookLocation;
  contacts?: unknown[];
  /** #78: respuesta a un botón de plantilla. */
  button?: WebhookButtonReply;
  /** #78: respuesta a un botón o a una lista de un mensaje interactivo. */
  interactive?: WebhookInteractiveReply;
  /** El mensaje al que responde (botones, citas): `id` es su wa_message_id. */
  context?: { from?: string; id?: string };
  /** 016: origen del anuncio, cuando la conversación nació de uno. */
  referral?: WebhookReferral;
};

export type WebhookStatus = {
  id: string;
  status: string;
  timestamp: string;
  recipient_id?: string;
  errors?: { code: number; title?: string; message?: string }[];
};

export type WebhookValue = {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: { profile?: { name?: string }; wa_id?: string; user_id?: string }[];
  messages?: WebhookMessage[];
  /** Echoes de coexistence (008): mensajes enviados desde la app del teléfono. */
  message_echoes?: WebhookMessage[];
  statuses?: WebhookStatus[];
  // message_template_status_update
  event?: string;
  message_template_name?: string;
  message_template_language?: string;
  message_template_id?: number | string;
  reason?: string | null;
};

export type WebhookChange = { field?: string; value?: WebhookValue };

export type WebhookPayload = {
  object?: string;
  entry?: { id?: string; changes?: WebhookChange[] }[];
};
