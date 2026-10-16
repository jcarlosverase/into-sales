import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * 021 — El contrato del despacho: lo que el CRM le manda a un cerebro externo
 * cuando un cliente escribe. Ver
 * `specs/021-standard-dispatch/contracts/dispatch.md`. Este módulo define la
 * FORMA del evento y la firma; no habla con nadie ni toca la base.
 *
 * La regla que lo sostiene: el cerebro recibe un evento NORMALIZADO. No sabe
 * si el mensaje vino de Meta o de Zernio y no tiene credenciales de canal, así
 * que agregar un canal no toca a los cerebros y agregar un cerebro no toca a
 * los canales.
 *
 * Es la misma forma que el despacho de Vocero Cloud (su
 * `src/server/brains/contract.ts`), para que un mismo cerebro sirva a las dos
 * ediciones. La única diferencia está en `mediaId`, y se explica abajo.
 */

export type EventChannel = "whatsapp" | "instagram" | "messenger" | "tiktok";

export type EventMessage = {
  id: string;
  at: string;
  type: string;
  text: string | null;
  /**
   * El id que acepta `GET /api/bot/media/{mediaId}` (el de Graph), no el id
   * interno del adjunto. En cloud es al revés porque allá la vuelta es
   * `/api/brains/media`; aquí la vuelta es `/api/bot/*` y no cambia.
   */
  mediaId: string | null;
  /** Solo con adjunto. */
  mimeType?: string | null;
  /** Solo con adjunto. */
  caption?: string | null;
};

export type EventDispatch = {
  dispatchId: string;
  organization: { id: string; slug: string | null };
  conversation: {
    id: string;
    channel: EventChannel;
    aiEnabled: boolean;
    windowOpen: boolean;
    windowExpiresAt: string | null;
  };
  contact: {
    id: string;
    displayName: string;
    identity: string;
  };
  messages: EventMessage[];
  firstMessageAt: string;
  lastMessageAt: string;
};

/** Lo que hace falta saber de un mensaje para meterlo al evento. */
export type MessageForEvent = {
  id: string;
  createdAt: Date;
  type: string;
  text: string | null;
  media: {
    waMediaId: string | null;
    mimeType: string | null;
    caption: string | null;
  } | null;
};

/**
 * Arma el evento. Pura, y es la ÚNICA que lo arma: el orden de las claves es
 * contrato —se firma el JSON tal como sale de aquí— y
 * `tests/unit/dispatch-contract.test.ts` fija un cuerpo y su firma byte a
 * byte. La prueba gemela vive en el repo del cerebro.
 */
export function buildEvent(data: {
  dispatchId: string;
  organization: { id: string; slug: string | null };
  conversation: {
    id: string;
    channel: EventChannel;
    aiEnabled: boolean;
    windowOpen: boolean;
    windowExpiresAt: Date | null;
  };
  contact: { id: string; displayName: string; identity: string };
  messages: MessageForEvent[];
  firstMessageAt: Date;
  lastMessageAt: Date;
}): EventDispatch {
  return {
    dispatchId: data.dispatchId,
    organization: {
      id: data.organization.id,
      slug: data.organization.slug,
    },
    conversation: {
      id: data.conversation.id,
      channel: data.conversation.channel,
      aiEnabled: data.conversation.aiEnabled,
      windowOpen: data.conversation.windowOpen,
      windowExpiresAt: data.conversation.windowExpiresAt?.toISOString() ?? null,
    },
    contact: {
      id: data.contact.id,
      displayName: data.contact.displayName,
      identity: data.contact.identity,
    },
    messages: data.messages.map(eventMessage),
    firstMessageAt: data.firstMessageAt.toISOString(),
    lastMessageAt: data.lastMessageAt.toISOString(),
  };
}

function eventMessage(m: MessageForEvent): EventMessage {
  const base = {
    id: m.id,
    at: m.createdAt.toISOString(),
    type: m.type,
    text: m.text,
    mediaId: m.media?.waMediaId ?? null,
  };
  // Sin algo que descargar, `mimeType` y `caption` no dicen nada: una
  // ubicación o una tarjeta de contacto no tienen media id.
  if (!m.media?.waMediaId) return base;
  return { ...base, mimeType: m.media.mimeType, caption: m.media.caption };
}

/**
 * 026 — Quien administra el negocio eliminó una conversación: el cerebro tiene
 * que olvidarla.
 *
 * Viaja a la MISMA URL y con la MISMA firma que un despacho. Se distingue por
 * `type`, que un despacho no lleva: quien no conozca este evento ve un cuerpo
 * sin `messages` y lo rechaza, que es inofensivo — no se reintenta.
 *
 * No lleva el contenido de lo borrado, solo con qué encontrarlo. `identity` va
 * porque un cerebro suele indexar su memoria por persona, no por el id de
 * conversación del CRM.
 */
export type EventForget = {
  type: "conversation.deleted";
  eventId: string;
  organization: { id: string; slug: string | null };
  conversation: { id: string; channel: EventChannel };
  contact: { id: string; identity: string };
  deletedAt: string;
};

export const TYPE_FORGET = "conversation.deleted" as const;

/**
 * El orden de las claves es contrato: se firma el JSON tal como sale de aquí.
 * Es el mismo cuerpo que manda Vocero Cloud, y la prueba gemela de `nea-agent`
 * (`tests/test_olvido.py`) lo tiene copiado byte a byte, igual que
 * `tests/unit/forget-contract.test.ts` aquí.
 */
export function buildEventForget(data: {
  eventId: string;
  organization: { id: string; slug: string | null };
  conversation: { id: string; channel: EventChannel };
  contact: { id: string; identity: string };
  deletedAt: Date;
}): EventForget {
  return {
    type: TYPE_FORGET,
    eventId: data.eventId,
    organization: {
      id: data.organization.id,
      slug: data.organization.slug,
    },
    conversation: {
      id: data.conversation.id,
      channel: data.conversation.channel,
    },
    contact: { id: data.contact.id, identity: data.contact.identity },
    deletedAt: data.deletedAt.toISOString(),
  };
}

export const HEADER_SIGNATURE = "x-vocero-signature";
export const HEADER_DISPATCH = "x-vocero-dispatch-id";
export const HEADER_ORG = "x-vocero-organization";
/** Para los eventos que no son un turno: hoy, `conversation.deleted` (026). */
export const HEADER_EVENT = "x-vocero-event";

/**
 * Firma del cuerpo CRUDO, con prefijo `sha256=`.
 *
 * El prefijo es contrato: el webhook de Zernio NO lo lleva y el nuestro SÍ. La
 * asimetría es del proveedor, no nuestra.
 */
export function signBody(rawBody: string, secret: string): string {
  const hex = createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");
  return `sha256=${hex}`;
}

/**
 * Verificación en tiempo constante. El CRM no verifica sus propios despachos:
 * existe para que el cerebro de prueba del arnés y las pruebas comprueben la
 * firma con la misma regla que debe usar un cerebro real.
 */
export function validSignature(
  rawBody: string,
  secret: string,
  receivedSignature: string | null
): boolean {
  if (!receivedSignature) return false;
  const expected = Buffer.from(signBody(rawBody, secret));
  const received = Buffer.from(receivedSignature);
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

/**
 * Cómo se clasifica lo que respondió el cerebro.
 *
 * Un 4xx (salvo 429) NO se reintenta: si el otro lado considera inválido el
 * cuerpo, mandárselo tres veces solo retrasa la caída a humano, que es lo
 * único que va a atender esa conversación. Un 3xx cae aquí también: no se
 * siguen redirecciones.
 */
export type ResultDelivery =
  | { ok: true }
  | { ok: false; retryable: boolean; detail: string };

export function classifyResponse(status: number): ResultDelivery {
  if (status >= 200 && status < 300) return { ok: true };
  if (status === 429 || status >= 500) {
    return {
      ok: false,
      retryable: true,
      detail: `el cerebro respondió ${status}`,
    };
  }
  return {
    ok: false,
    retryable: false,
    detail: `el cerebro respondió ${status} (no se reintenta)`,
  };
}
