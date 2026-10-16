import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { readConfigDispatch } from "@/server/brains/config";
import {
  buildEventValue,
  deliver,
  burstOf,
  withoutDispatch,
} from "@/server/brains/deliver";
import {
  expireToHuman,
  discardDispatch,
  enqueueDispatch,
  markDelivered,
  messagesNoted,
  handOffToHuman,
  retryOrExpire,
  renewLease,
  takePending,
  type DispatchRow,
} from "@/server/dispatch/outbox";

/**
 * 021 — El worker del despachador.
 *
 * Dentro del proceso, como el resto del trabajo de fondo del repo (sin colas
 * externas: constitución II). Lo que lo hace fiable no es el proceso sino el
 * outbox: si muere a mitad, el lease expira y el siguiente barrido lo retoma;
 * si el contenedor se reinicia, los pendientes siguen ahí y el arranque los
 * reanuda (`instrumentation-node.ts`).
 *
 * Puerto de `src/server/dispatch/worker.ts` de Vocero Cloud.
 */

/**
 * El barrido de fondo. No es lo que dispara el caso normal —para eso está
 * `programarTanda`— sino la red: filas en espera tras un fallo, las que
 * encoló otro proceso y las que quedaron de antes de un reinicio.
 */
const INTERVAL_MS = 2000;
const BY_BATCH = 10;
/**
 * Margen sobre la hora de la cita. `tomarPendientes` filtra por
 * `not_before <= ahora`: despertar clavado en el borde puede llegar un
 * milisegundo antes, no ver la fila y dejársela al barrido.
 */
const MARGIN_MS = 50;
/** Cada cuánto se renueva el lease mientras se espera al cerebro. */
const HEARTBEAT_MS = 20_000;

type Status = {
  timer: NodeJS.Timeout | null;
  running: boolean;
  // La próxima cita y su hora. Se guarda la hora para no pisar una cita más
  // próxima con otra más lejana: encolar en dos conversaciones a la vez
  // dejaría a la primera esperando a la segunda.
  booking: NodeJS.Timeout | null;
  bookingAt: number | null;
};

// En globalThis porque en dev los módulos se evalúan más de una vez (una por
// ruta) y todas las copias deben compartir el mismo worker: dos temporizadores
// sobre el mismo outbox se pisarían el lease.
const globalForWorker = globalThis as unknown as {
  __voceroDispatchWorker?: Status;
};

function status(): Status {
  if (!globalForWorker.__voceroDispatchWorker) {
    globalForWorker.__voceroDispatchWorker = {
      timer: null,
      running: false,
      booking: null,
      bookingAt: null,
    };
  }
  return globalForWorker.__voceroDispatchWorker;
}

export function startWorker(): void {
  const e = status();
  if (e.timer) return;
  e.timer = setInterval(() => void batch(), INTERVAL_MS);
  // `unref` para que el temporizador no impida que el proceso termine.
  e.timer.unref?.();
}

/**
 * Despierta al worker cuando venza esta ventana, además del barrido.
 *
 * La ventana de agrupado existe por una razón (la gente escribe a trozos),
 * pero los hasta 2 s de después eran solo el worker sin enterarse.
 *
 * Una sola cita, la más próxima. Las demás filas que venzan entretanto las
 * recoge esa misma tanda, porque toma TODAS las vencidas, no solo la suya.
 */
export function scheduleBatch(when: Date): void {
  const e = status();
  const target = when.getTime() + MARGIN_MS;
  if (e.bookingAt !== null && e.bookingAt <= target) return;
  if (e.booking) clearTimeout(e.booking);
  e.bookingAt = target;
  e.booking = setTimeout(() => {
    e.booking = null;
    e.bookingAt = null;
    void batch();
  }, Math.max(0, target - Date.now()));
  e.booking.unref?.();
}

export function stopWorker(): void {
  const e = status();
  if (e.timer) clearInterval(e.timer);
  e.timer = null;
  if (e.booking) clearTimeout(e.booking);
  e.booking = null;
  e.bookingAt = null;
}

/** Una pasada. Devuelve cuántos despachos tomó. */
export async function batch(now: Date = new Date()): Promise<number> {
  const e = status();
  if (e.running) return 0;
  e.running = true;
  try {
    let count = 0;
    for (; count < BY_BATCH; count++) {
      // De una en una, y con la hora de AHORA: las que esperan en la cola no
      // envejecen detrás de un POST lento con el lease ya corriendo.
      const [row] = await takePending(1, count === 0 ? now : new Date());
      if (!row) break;
      const heartbeat = setInterval(() => {
        void renewLease(row).catch(() =>
          console.error("[despacho] no se pudo renovar el lease")
        );
      }, HEARTBEAT_MS);
      heartbeat.unref?.();
      try {
        await process(row);
      } finally {
        clearInterval(heartbeat);
      }
    }
    return count;
  } catch (err) {
    console.error("[despacho] la tanda falló:", err);
    return 0;
  } finally {
    e.running = false;
  }
}

async function process(row: DispatchRow): Promise<void> {
  const config = readConfigDispatch();
  if (!config.active) {
    // Quedó de antes de que se quitara o se rompiera la configuración: ya no
    // hay a quién entregarlo, y el agente incluido vuelve a ser quien manda.
    await discardDispatch(row, "el despacho ya no está configurado");
    return;
  }

  /**
   * La pausa se vuelve a mirar al ENTREGAR, no solo al encolar.
   *
   * Entre un momento y otro está la ventana de agrupado: si alguien pausa la
   * IA en esos segundos, el turno ya no le corresponde a ningún cerebro.
   */
  const [conv] = await getDb()
    .select({
      aiEnabled: schema.conversation.aiEnabled,
      handoffAt: schema.conversation.handoffAt,
      isTest: schema.conversation.isTest,
    })
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.id, row.conversationId),
        eq(schema.conversation.organizationId, row.organizationId)
      )
    )
    .limit(1);
  if (!conv) {
    await discardDispatch(row, "la conversación ya no existe");
    return;
  }
  if (!conv.aiEnabled || conv.handoffAt || conv.isTest) {
    await discardDispatch(row, "la IA se pausó antes de despachar");
    return;
  }

  const event = await buildEventValue(row);
  if (!event) {
    await discardDispatch(row, "la conversación ya no existe");
    return;
  }
  /**
   * 025 — Un despacho sin mensajes no se entrega.
   *
   * Pasa cuando lo que lo provocó ya lo contestó una persona dentro de la
   * ventana. No es una caída del cerebro: mandárselo vacío sería pedirle un
   * turno sobre nada —Nea lo rechaza con 422—, y un 4xx no se reintenta: la
   * conversación acabaría con un humano por un fallo que no existió.
   */
  if (event.messages.length === 0) {
    await discardDispatch(row, "sin mensajes por despachar");
    return;
  }

  const result = await deliver(event, config);
  // El lease pudo vencer mientras se esperaba al cerebro y otro pudo retomar
  // la fila: si ya no es nuestra, lo que hagamos aquí pisaría su trabajo.
  if (!(await renewLease(row))) return;

  if (result.ok) {
    if (!(await markDelivered(row))) return;
    /**
     * 025 — Lo que entró mientras el evento iba en vuelo no viajó en él.
     *
     * El evento se armó antes de que ese mensaje existiera. `encolarDespacho`
     * lo dejó anotado en la fila, así que aquí se relee: lo anotado (y lo que
     * haya en la ráfaga) menos lo que el cerebro recibió es lo que se le sigue
     * debiendo, y sale en otro despacho con esos ids anotados.
     */
    const actual = await burstOf(
      row.organizationId,
      row.conversationId,
      await messagesNoted(row)
    );
    const pending = withoutDispatch(
      event.messages.map((m) => m.id),
      actual
    );
    if (pending.length) {
      const { notBefore } = await enqueueDispatch({
        organizationId: row.organizationId,
        conversationId: row.conversationId,
        messageIds: pending,
      });
      scheduleBatch(notBefore);
    }
    return;
  }

  console.error(
    `[despacho] ${row.id} (intento ${row.attempts}): ${result.detail}`
  );
  const expired = result.retryable
    ? await retryOrExpire(row, result.detail)
    : await expireToHuman(row, result.detail);
  if (expired) await handOffToHuman(row.organizationId, row.conversationId);
}
