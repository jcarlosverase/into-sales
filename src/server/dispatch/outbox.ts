import { and, eq, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { getEnv } from "@/lib/env";
import { publish } from "@/server/events/bus";

/**
 * 021 — El outbox del despachador.
 *
 * Hace cumplir «bandeja primero, cerebro después»: el mensaje ya está en
 * `message` antes de que exista una fila aquí. Si el despacho falla, el
 * mensaje sigue en la bandeja; si el proceso muere, el lease expira y el
 * siguiente barrido la retoma.
 *
 * El agrupado de ráfagas NO se implementa con temporizadores: lo hace el
 * índice único parcial `dispatch_conversation_vivo_uq`, que permite como
 * máximo UN despacho vivo por conversación. Encolar cinco mensajes seguidos
 * hace un INSERT y cuatro UPDATE de la ventana. La garantía la da Postgres,
 * así que sobrevive a que alguien reescriba el worker.
 *
 * Puerto de `src/server/dispatch/outbox.ts` de Vocero Cloud.
 */

/**
 * Cuánto se espera desde el último mensaje antes de despachar.
 *
 * Es la MISMA variable que usa el agente incluido (`AGENT_COALESCE_MS`), y a
 * propósito: la pregunta que responde es idéntica —cuánto esperar a que
 * alguien termine de escribir su ráfaga— y los dos caminos nunca están vivos a
 * la vez. Dos nombres para un solo concepto solo servirían para que alguien
 * bajara uno y se preguntara por qué no pasa nada.
 */
export function windowCoalesceMs(): number {
  return getEnv().AGENT_COALESCE_MS;
}

/** Cuánto tiempo un worker se reserva una fila antes de que otro pueda tomarla. */
export const LEASE_MS = 180_000;
export const MAX_ATTEMPTS = 3;
/** Espera tras el intento 1 y tras el 2. El tercero ya no reintenta. */
export const BACKOFF_MS = [1000, 4000];

/** Pura: la espera base antes del siguiente intento. */
export function retryWait(attemptsDone: number): number {
  const i = Math.min(Math.max(attemptsDone, 1), BACKOFF_MS.length) - 1;
  return BACKOFF_MS[i] ?? 1000;
}

export type DispatchRow = typeof schema.dispatch.$inferSelect;

/**
 * Encola (o extiende) el despacho de una conversación.
 *
 * Idempotente por construcción: si ya hay uno pendiente, empuja su ventana en
 * vez de crear otro. Devuelve CUÁNDO vence esa ventana, para que quien encola
 * despierte al worker en ese instante en vez de esperar a su siguiente
 * barrido.
 *
 * 025 — `messageIds` son los entrantes que provocan esta llamada. Se anotan en
 * la fila viva —también si va EN VUELO— porque son lo que ese despacho le debe
 * al cerebro: la ráfaga sola no alcanza a decirlo (ver `rafagaDe`).
 */
export async function enqueueDispatch(params: {
  organizationId: string;
  conversationId: string;
  messageIds?: readonly string[];
  now?: Date;
}): Promise<{ id: string; notBefore: Date }> {
  const db = getDb();
  const now = params.now ?? new Date();
  const notBefore = new Date(now.getTime() + windowCoalesceMs());
  const messageIds = [...new Set(params.messageIds ?? [])];
  // Se concatena en SQL y no leyendo-y-escribiendo: dos mensajes que llegan a
  // la vez no pueden pisarse la lista el uno al otro.
  const noted: { messageIds?: SQL } = messageIds.length
    ? {
        messageIds: sql`coalesce(${schema.dispatch.messageIds}, '[]'::jsonb) || ${JSON.stringify(messageIds)}::jsonb`,
      }
    : {};

  // Casi siempre una vuelta. Se repite solo si la fila viva cambió bajo los
  // pies: otro mensaje ganó el índice único, o el worker la tomó justo ahora.
  for (let roundTrip = 0; ; roundTrip++) {
    const [alive] = await db
      .select()
      .from(schema.dispatch)
      .where(
        and(
          eq(schema.dispatch.conversationId, params.conversationId),
          inArray(schema.dispatch.status, ["pendiente", "en_vuelo"])
        )
      )
      .limit(1);

    if (alive) {
      // En vuelo no se toca `not_before`: el cerebro ya tiene el evento, sin
      // este mensaje, y adelantar la ventana no lo haría llegar antes. Queda
      // anotado en la fila, y el worker, al entregarla, ve que lo sigue
      // debiendo y encola otro despacho.
      const inFlight = alive.status === "en_vuelo";
      if (inFlight && !messageIds.length) {
        return { id: alive.id, notBefore: alive.notBefore };
      }
      /**
       * Solo si SIGUE vivo.
       *
       * Entre el SELECT de arriba y este UPDATE el worker pudo terminarlo. Lo
       * anotado en una fila ya entregada no lo vuelve a leer nadie: ese
       * mensaje se quedaría sin despacho. Si ya no está vivo, abre su fila.
       */
      const [touched] = await db
        .update(schema.dispatch)
        .set(
          inFlight
            ? noted
            : { notBefore, lastMessageAt: now, updatedAt: now, ...noted }
        )
        .where(
          and(
            eq(schema.dispatch.id, alive.id),
            eq(schema.dispatch.status, alive.status)
          )
        )
        .returning({ notBefore: schema.dispatch.notBefore });
      if (touched) return { id: alive.id, notBefore: touched.notBefore };
    }

    const id = newId("dispatch");
    try {
      await db.insert(schema.dispatch).values({
        id,
        organizationId: params.organizationId,
        conversationId: params.conversationId,
        status: "pendiente",
        notBefore,
        firstMessageAt: now,
        lastMessageAt: now,
        messageIds: messageIds.length ? messageIds : null,
      });
      return { id, notBefore };
    } catch (err) {
      // Dos mensajes de la misma conversación entraron a la vez y el otro ganó
      // el índice único. Su fila cubre a este mensaje, pero no lo tiene
      // anotado: se vuelve a empezar para anotarlo en ella.
      if (!isUniquenessViolation(err)) throw err;
      if (roundTrip >= 2 || !messageIds.length) return { id, notBefore };
    }
  }
}

/**
 * 025 — Los ids anotados en la fila AHORA, no los que traía cuando se reclamó.
 *
 * Mientras el despacho iba en vuelo pudieron anotarse más: son justo los que
 * el evento no llevó.
 */
export async function messagesNoted(rowValue: DispatchRow): Promise<string[]> {
  const [row] = await getDb()
    .select({ messageIds: schema.dispatch.messageIds })
    .from(schema.dispatch)
    .where(
      and(
        eq(schema.dispatch.id, rowValue.id),
        eq(schema.dispatch.organizationId, rowValue.organizationId)
      )
    )
    .limit(1);
  return [...new Set(row?.messageIds ?? [])];
}

function isUniquenessViolation(err: unknown): boolean {
  const code =
    (err as { code?: string })?.code ??
    (err as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

/**
 * Toma hasta `limite` despachos cuya ventana ya venció.
 *
 * El lease es lo que permite que varios procesos (o el mismo tras reiniciar)
 * no se pisen: se marca `en_vuelo` con `leased_until`, y una fila cuyo lease
 * expiró vuelve a estar disponible aunque siga marcada en vuelo.
 */
export async function takePending(
  limit = 10,
  now: Date = new Date()
): Promise<DispatchRow[]> {
  const db = getDb();
  const candidates = await db
    .select()
    .from(schema.dispatch)
    .where(
      or(
        and(
          eq(schema.dispatch.status, "pendiente"),
          lte(schema.dispatch.notBefore, now)
        ),
        // Lease vencido: el worker que la tomó murió a mitad.
        and(
          eq(schema.dispatch.status, "en_vuelo"),
          lte(schema.dispatch.leasedUntil, now)
        )
      )
    )
    .orderBy(schema.dispatch.notBefore)
    .limit(limit);

  const taken: DispatchRow[] = [];
  for (const rowValue of candidates) {
    /**
     * La reclamación es este UPDATE, no el SELECT de arriba, y se condiciona
     * al estado y al contador de intentos.
     *
     * Comparar el timestamp parecía un candado más fino, pero es frágil de una
     * forma silenciosa: Postgres guarda microsegundos y el `Date` de JS solo
     * milisegundos, así que el valor releído puede no ser idéntico al
     * almacenado y el UPDATE no casa nunca. El contador entero distingue a dos
     * dueños aunque ambos vean la fila en vuelo.
     */
    const res = await db
      .update(schema.dispatch)
      .set({
        status: "en_vuelo",
        leasedUntil: new Date(now.getTime() + LEASE_MS),
        attempts: rowValue.attempts + 1,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.dispatch.id, rowValue.id),
          eq(schema.dispatch.status, rowValue.status),
          eq(schema.dispatch.attempts, rowValue.attempts),
          rowValue.status === "en_vuelo"
            ? lte(schema.dispatch.leasedUntil, now)
            : lte(schema.dispatch.notBefore, now)
        )
      )
      .returning();
    if (res[0]) taken.push(res[0]);
  }
  return taken;
}

/** La fila sigue siendo de quien la tomó. */
function owner(rowValue: DispatchRow) {
  return and(
    eq(schema.dispatch.id, rowValue.id),
    eq(schema.dispatch.status, "en_vuelo"),
    eq(schema.dispatch.attempts, rowValue.attempts)
  );
}

export async function renewLease(rowValue: DispatchRow): Promise<boolean> {
  const rows = await getDb()
    .update(schema.dispatch)
    .set({ leasedUntil: new Date(Date.now() + LEASE_MS) })
    .where(owner(rowValue))
    .returning({ id: schema.dispatch.id });
  return rows.length === 1;
}

export async function markDelivered(rowValue: DispatchRow): Promise<boolean> {
  const rows = await getDb()
    .update(schema.dispatch)
    .set({
      status: "entregado",
      leasedUntil: null,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(owner(rowValue))
    .returning({ id: schema.dispatch.id });
  return rows.length === 1;
}

/**
 * Reprograma un intento más, o caduca si ya no quedan.
 * Devuelve `true` si caducó (quien llama pasa la conversación a un humano).
 */
export async function retryOrExpire(
  rowValue: DispatchRow,
  detail: string,
  now: Date = new Date()
): Promise<boolean> {
  if (rowValue.attempts >= MAX_ATTEMPTS) return expireToHuman(rowValue, detail);

  const base = retryWait(rowValue.attempts);
  // Variación: sin ella, N despachos que fallaron a la vez reintentan a la
  // vez y vuelven a tumbar al cerebro que apenas se levantaba.
  const wait = base + Math.floor(Math.random() * base * 0.3);
  await getDb()
    .update(schema.dispatch)
    .set({
      status: "pendiente",
      notBefore: new Date(now.getTime() + wait),
      leasedUntil: null,
      lastError: detail.slice(0, 300),
      updatedAt: now,
    })
    .where(owner(rowValue));
  return false;
}

/** Caduca sin más intentos. `true` si la fila era nuestra y quedó caducada. */
export async function expireToHuman(
  rowValue: DispatchRow,
  detail: string
): Promise<boolean> {
  const rows = await getDb()
    .update(schema.dispatch)
    .set({
      status: "caducado_a_humano",
      leasedUntil: null,
      lastError: detail.slice(0, 300),
      updatedAt: new Date(),
    })
    .where(owner(rowValue))
    .returning({ id: schema.dispatch.id });
  return rows.length === 1;
}

/**
 * El turno ya no debe existir: se pausó la IA durante la ventana, alguien
 * contestó a mano, o la conversación ya no está.
 *
 * No es un fallo del cerebro ni necesita aviso. Por eso no pasa por
 * `caducarAHumano`, que cuenta como caída y pausa la conversación.
 */
export async function discardDispatch(
  rowValue: DispatchRow,
  detail: string
): Promise<void> {
  await getDb()
    .update(schema.dispatch)
    .set({
      status: "descartado",
      leasedUntil: null,
      lastError: detail.slice(0, 300),
      updatedAt: new Date(),
    })
    .where(owner(rowValue));
}

/**
 * El cerebro no pudo recibir el turno: la conversación pasa a un humano.
 *
 * Es el traspaso que ya existe —el mismo que deja `POST /api/bot/handoff` y el
 * mismo motivo (`error`) que usa un cerebro cuando no puede contestar—, y
 * publica el mismo evento, así que la bandeja lo ve en vivo. Solo escribe en
 * la transición: no pisa la hora ni el motivo de un traspaso anterior.
 */
export async function handOffToHuman(
  organizationId: string,
  conversationId: string
): Promise<void> {
  const now = new Date();
  const rows = await getDb()
    .update(schema.conversation)
    .set({
      aiEnabled: false,
      handoffAt: now,
      handoffReason: "error",
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.conversation.id, conversationId),
        eq(schema.conversation.organizationId, organizationId),
        isNull(schema.conversation.handoffAt)
      )
    )
    .returning({ id: schema.conversation.id });
  if (!rows[0]) return;
  publish(organizationId, {
    type: "conversation.updated",
    data: { conversation: { id: conversationId, handoffReason: "error" } },
  });
}
