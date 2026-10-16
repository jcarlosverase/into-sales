import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  buildEvent,
  classifyResponse,
  signBody,
  HEADER_DISPATCH,
  HEADER_EVENT,
  HEADER_SIGNATURE,
  HEADER_ORG,
  type EventForget,
  type EventDispatch,
  type MessageForEvent,
  type ResultDelivery,
} from "@/server/brains/contract";
import { readConfigDispatch } from "@/server/brains/config";
import type { DispatchRow } from "@/server/dispatch/outbox";
import { isWindowOpen, windowExpiresAt } from "@/server/inbox/window";
import { windowMsFor } from "@/server/channels/capabilities";

/**
 * 021 — Entrega de un despacho al cerebro: leer la ráfaga, armar el evento y
 * hacer el POST firmado. Puerto de `src/server/brains/deliver.ts` de Vocero
 * Cloud sin tipos de cerebro: aquí hay uno, el de `BRAIN_DISPATCH_URL`.
 */

/** Lo que el CRM espera por el 2xx. Significa «recibido», no «ya contesté». */
export const TIMEOUT_DELIVERY_MS = 20_000;

/** Cuántos mensajes hacia atrás se mira para delimitar la ráfaga. */
const MESSAGES_WINDOW = 20;

/**
 * Las columnas de un mensaje que el evento necesita, con su adjunto. Función y
 * no constante: el esquema no se toca al importar el módulo.
 */
function messageColumns() {
  return {
    id: schema.message.id,
    direction: schema.message.direction,
    type: schema.message.type,
    text: schema.message.text,
    createdAt: schema.message.createdAt,
    waMediaId: schema.mediaAsset.waMediaId,
    mimeType: schema.mediaAsset.mimeType,
    caption: schema.mediaAsset.caption,
    assetId: schema.mediaAsset.id,
  };
}

function forEvent(m: {
  id: string;
  createdAt: Date;
  type: string;
  text: string | null;
  waMediaId: string | null;
  mimeType: string | null;
  caption: string | null;
  assetId: string | null;
}): MessageForEvent {
  return {
    id: m.id,
    createdAt: m.createdAt,
    type: m.type,
    text: m.text,
    media: m.assetId
      ? { waMediaId: m.waMediaId, mimeType: m.mimeType, caption: m.caption }
      : null,
  };
}

/**
 * La ráfaga = lo que el cliente dijo y todavía no se le ha respondido.
 *
 * Se delimita por el último mensaje SALIENTE de la conversación, no por las
 * horas del despacho: `first_message_at` se toma después de persistir el
 * mensaje, así que el primero de la ráfaga podía quedar unos milisegundos
 * ANTES y caerse del evento. Delimitar por la conversación es además robusto
 * frente a relojes desalineados.
 *
 * 025 — `debidos` son los ids que el despacho tiene anotados
 * (`dispatch.message_ids`). El corte por el último saliente confunde «sin
 * responder» con «sin entregar»: lo que el cliente escribe mientras el cerebro
 * piensa queda DETRÁS de la respuesta a lo anterior, y ese mensaje se quedaba
 * sin despacho. Un debido viaja aunque tenga una respuesta del agente después.
 *
 * Lo que sí lo salda es que conteste una PERSONA (cualquier saliente que no
 * sea del agente): ese mensaje ya tuvo quien lo atendiera, y mandárselo al
 * cerebro sería contestarle dos veces al cliente.
 */
export async function burstOf(
  organizationId: string,
  conversationId: string,
  owed: readonly string[] = []
): Promise<MessageForEvent[]> {
  const db = getDb();
  const rows = await db
    .select(messageColumns())
    .from(schema.message)
    .leftJoin(
      schema.mediaAsset,
      eq(schema.mediaAsset.id, schema.message.mediaAssetId)
    )
    .where(
      scoped(
        schema.message.organizationId,
        organizationId,
        eq(schema.message.conversationId, conversationId)
      )
    )
    .orderBy(desc(schema.message.createdAt))
    .limit(MESSAGES_WINDOW);

  const sorted = rows.slice().reverse();
  const lastOutput = sorted.reduce(
    (idx, m, i) => (m.direction === "out" ? i : idx),
    -1
  );
  const burst = sorted
    .slice(lastOutput + 1)
    .filter((m) => m.direction === "in");

  const inBurst = new Set(burst.map((m) => m.id));
  const missing = [...new Set(owed)].filter((id) => !inBurst.has(id));
  if (!missing.length) return burst.map(forEvent);

  // La comparación de horas se hace en Postgres, que guarda microsegundos: en
  // JS dos mensajes del mismo milisegundo no tienen orden.
  const overdue = await db
    .select(messageColumns())
    .from(schema.message)
    .leftJoin(
      schema.mediaAsset,
      eq(schema.mediaAsset.id, schema.message.mediaAssetId)
    )
    .where(
      scoped(
        schema.message.organizationId,
        organizationId,
        and(
          eq(schema.message.conversationId, conversationId),
          eq(schema.message.direction, "in"),
          inArray(schema.message.id, missing),
          sql`${schema.message.createdAt} > coalesce((
            select max(s.created_at) from message s
            where s.organization_id = ${organizationId}
              and s.conversation_id = ${conversationId}
              and s.direction = 'out'
              and s.ai_generated = false
          ), '-infinity'::timestamptz)`
        )
      )
    )
    .orderBy(schema.message.createdAt);
  // Los atrasados son, por definición, anteriores al último saliente; la
  // ráfaga, posterior. Concatenar ya los deja en orden.
  return [...overdue, ...burst].map(forEvent);
}

/**
 * Pura: ¿la ráfaga de ahora trae algo que el evento entregado no llevaba?
 *
 * Un mensaje que entra mientras su despacho está en vuelo no viaja en ese
 * evento (el cerebro ya lo tiene), así que al entregar se vuelve a mirar: si
 * hay algo nuevo, se encola otro despacho. Se compara por id y no por hora por
 * lo mismo que el lease: microsegundos contra milisegundos.
 */
export function hasUndispatchedMessages(
  delivered: readonly string[],
  currentBurst: readonly { id: string }[]
): boolean {
  return withoutDispatch(delivered, currentBurst).length > 0;
}

/** Pura: cuáles. Son los ids que el despacho siguiente lleva anotados. */
export function withoutDispatch(
  delivered: readonly string[],
  currentBurst: readonly { id: string }[]
): string[] {
  const seen = new Set(delivered);
  return currentBurst.filter((m) => !seen.has(m.id)).map((m) => m.id);
}

/**
 * Arma el evento normalizado desde la base. `null` si la conversación o el
 * contacto ya no existen.
 *
 * 025 — Puede salir con `messages` vacío: una persona contestó a mano dentro
 * de la ventana y ya no se debe nada. Ese evento no se entrega; quien llama lo
 * descarta.
 */
export async function buildEventValue(
  row: DispatchRow
): Promise<EventDispatch | null> {
  const db = getDb();
  const [conv] = await db
    .select()
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        row.organizationId,
        eq(schema.conversation.id, row.conversationId)
      )
    )
    .limit(1);
  if (!conv) return null;

  const [org] = await db
    .select({ id: schema.organization.id, slug: schema.organization.slug })
    .from(schema.organization)
    .where(eq(schema.organization.id, row.organizationId))
    .limit(1);
  if (!org) return null;

  const [contact] = await db
    .select()
    .from(schema.contact)
    .where(
      scoped(
        schema.contact.organizationId,
        row.organizationId,
        eq(schema.contact.id, conv.contactId)
      )
    )
    .limit(1);
  if (!contact) return null;

  const messages = await burstOf(
    row.organizationId,
    conv.id,
    row.messageIds ?? []
  );

  return buildEvent({
    dispatchId: row.id,
    organization: org,
    conversation: {
      id: conv.id,
      channel: conv.channel,
      aiEnabled: conv.aiEnabled,
      // 022: la ventana es la del canal (48 h en TikTok).
      windowOpen: isWindowOpen(
        conv.lastInboundAt,
        new Date(),
        windowMsFor(conv.channel)
      ),
      windowExpiresAt: windowExpiresAt(
        conv.lastInboundAt,
        windowMsFor(conv.channel)
      ),
    },
    contact: {
      id: contact.id,
      displayName: contact.name,
      identity: contact.waIdentity,
    },
    messages,
    firstMessageAt: row.firstMessageAt,
    lastMessageAt: row.lastMessageAt,
  });
}

/**
 * El POST firmado.
 *
 * Se serializa UNA vez y se firma ese string: firmar un objeto re-serializado
 * produciría una firma que el otro lado no puede reproducir. No se siguen
 * redirecciones —un cerebro no redirige, y seguirlas sería mandarle el turno a
 * donde diga otro—, y ni el cuerpo ni la llave llegan a un log.
 */
export async function deliver(
  event: EventDispatch,
  destination: { url: string; secret: string },
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<ResultDelivery> {
  const body = JSON.stringify(event);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? TIMEOUT_DELIVERY_MS
  );
  try {
    const res = await (opts.fetchImpl ?? fetch)(destination.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [HEADER_SIGNATURE]: signBody(body, destination.secret),
        [HEADER_DISPATCH]: event.dispatchId,
        [HEADER_ORG]: event.organization.slug ?? event.organization.id,
      },
      redirect: "manual",
      cache: "no-store",
      body: body,
      signal: controller.signal,
    });
    await res.body?.cancel().catch(() => {});
    return classifyResponse(res.status);
  } catch {
    // Sin respuesta a tiempo, nombre que no resuelve, conexión rechazada:
    // todo reintentable. El cerebro puede estar reiniciándose.
    return {
      ok: false,
      retryable: true,
      detail: controller.signal.aborted
        ? `el cerebro no contestó en ${Math.round((opts.timeoutMs ?? TIMEOUT_DELIVERY_MS) / 1000)} s`
        : "no se pudo conectar con el cerebro",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 026 — Lo que ve quien eliminó: si el cerebro confirmó que olvidó. */
export type ResultForget = "no_aplica" | "avisado" | "sin_confirmar";

/**
 * No se le hace esperar a quien elimina lo que espera un despacho: quien acusa
 * recibo de un borrado solo tiene que guardarlo, no pensar una respuesta.
 */
export const TIMEOUT_FORGET_MS = 8000;

/**
 * 026 — Le avisa al cerebro que una conversación se eliminó.
 *
 * Un solo intento, sin cola. El borrado en el CRM ya ocurrió y no depende de
 * esto, y el contrato le pide al cerebro tratar un `conversation.id` nuevo
 * para la misma persona como una conversación nueva — así un aviso perdido no
 * deja memoria en uso, solo guardada hasta que esa persona vuelva a escribir.
 *
 * Sin despacho configurado no hay a quién avisar: el agente incluido no guarda
 * nada aparte, su memoria ERAN los mensajes. Nunca lanza.
 */
export async function notifyForget(
  event: EventForget,
  opts: {
    destination?: { url: string; secret: string } | null;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
  } = {}
): Promise<ResultForget> {
  const config = readConfigDispatch();
  const destination =
    opts.destination !== undefined
      ? opts.destination
      : config.active
        ? { url: config.url, secret: config.secret }
        : null;
  if (!destination) return "no_aplica";

  // Se serializa UNA vez y se firma ese string, igual que un despacho.
  const body = JSON.stringify(event);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? TIMEOUT_FORGET_MS);
  try {
    const res = await (opts.fetchImpl ?? fetch)(destination.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [HEADER_SIGNATURE]: signBody(body, destination.secret),
        [HEADER_EVENT]: event.type,
        [HEADER_ORG]: event.organization.slug ?? event.organization.id,
      },
      redirect: "manual",
      cache: "no-store",
      body: body,
      signal: controller.signal,
    });
    await res.body?.cancel().catch(() => {});
    return res.status >= 200 && res.status < 300 ? "avisado" : "sin_confirmar";
  } catch {
    return "sin_confirmar";
  } finally {
    clearTimeout(timer);
  }
}
