import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { logger } from "@/lib/observability/logger";
import { CentralWalletError, pushApple } from "@/server/central/wallet";
import { stampCardEnabled } from "./flag";
import { syncGoogleObject } from "./google-pass";

/**
 * 1023, D9 y AC10 — Llevar cada cambio de una tarjeta a los wallets donde
 * está guardada. El sello se guarda siempre primero (con
 * `wallet_sync_pending`); esto corre después, fuera de la petición, y si el
 * central no responde lo reintenta el temporizador con espera creciente. Es
 * idempotente: Apple vuelve a pedir el pase entero y Google aplica por
 * versión.
 */

export type SyncOutcome = "done" | "retry";

export async function syncCard(organizationId: string, cardId: string): Promise<SyncOutcome> {
  const db = getDb();
  const [card] = await db
    .select()
    .from(schema.stampCard)
    .where(scoped(schema.stampCard.organizationId, organizationId, eq(schema.stampCard.id, cardId)))
    .limit(1);
  if (!card || !card.walletSyncPending) return "done";

  let retry = false;
  const fail = (wallet: string, err: unknown) => {
    const transient = !(err instanceof CentralWalletError) || err.transient;
    if (transient) retry = true;
    logger.warn(
      { event: "stamp_card.wallet_sync_failed", wallet, code: err instanceof CentralWalletError ? err.code : "error", retry: transient },
      "wallet sync failed"
    );
  };

  // Apple: un aviso vacío a cada dispositivo; el iPhone pide el pase al CRM.
  const registrations = await db
    .select({ id: schema.applePassRegistration.id, pushToken: schema.applePassRegistration.pushToken })
    .from(schema.applePassRegistration)
    .where(scoped(schema.applePassRegistration.organizationId, organizationId, eq(schema.applePassRegistration.cardId, card.id)));
  if (registrations.length > 0) {
    try {
      const { invalid } = await pushApple(organizationId, [...new Set(registrations.map((r) => r.pushToken))]);
      if (invalid.length > 0) {
        await db
          .delete(schema.applePassRegistration)
          .where(
            and(
              eq(schema.applePassRegistration.cardId, card.id),
              inArray(schema.applePassRegistration.pushToken, invalid)
            )
          );
      }
    } catch (err) {
      fail("apple", err);
    }
  }

  // Google: desde que se dio el enlace de guardar, el central aplica cada cambio.
  if (card.googleLinkIssuedAt) {
    try {
      await syncGoogleObject(card);
    } catch (err) {
      fail("google", err);
    }
  }

  if (!retry) {
    // Solo si nadie la cambió mientras tanto: ese cambio trae su propio pendiente.
    await db
      .update(schema.stampCard)
      .set({ walletSyncPending: false })
      .where(and(eq(schema.stampCard.id, card.id), eq(schema.stampCard.passVersion, card.passVersion)));
  }
  return retry ? "retry" : "done";
}

/** Tras un sello, canje o ajuste: lo intenta ya, sin esperar ni lanzar. */
export function kickWalletSync(organizationId: string, cardId: string): void {
  setImmediate(() => {
    syncCard(organizationId, cardId).catch((err) => {
      logger.warn({ event: "stamp_card.wallet_sync_error", name: err instanceof Error ? err.name : "Error" }, "wallet sync error");
    });
  });
}

/** Tras editar el programa: todas las tarjetas pendientes de la organización. */
export function kickProgramSync(organizationId: string): void {
  setImmediate(() => {
    void syncPending({ organizationId }).catch(() => undefined);
  });
}

// ── El temporizador de reintentos ────────────────────────────────────────────

const RETRY_STEPS_S = [60, 120, 300, 900, 1800, 3600];
type Backoff = { attempts: number; nextAt: number };
const state = globalThis as unknown as { __walletSyncBackoff?: Map<string, Backoff>; __walletSyncTimer?: ReturnType<typeof setInterval> | null };
function backoffs(): Map<string, Backoff> {
  state.__walletSyncBackoff ??= new Map();
  return state.__walletSyncBackoff;
}

/** Una vuelta: las tarjetas pendientes cuyo turno llegó. Devuelve cuántas quedaron por reintentar. */
export async function syncPending({ organizationId, now = Date.now(), limit = 200 }: { organizationId?: string; now?: number; limit?: number } = {}): Promise<number> {
  const rows = await getDb()
    .select({ id: schema.stampCard.id, organizationId: schema.stampCard.organizationId })
    .from(schema.stampCard)
    .where(
      organizationId
        ? scoped(schema.stampCard.organizationId, organizationId, eq(schema.stampCard.walletSyncPending, true))
        : eq(schema.stampCard.walletSyncPending, true)
    )
    .limit(limit);
  let retrying = 0;
  const map = backoffs();
  for (const row of rows) {
    const wait = map.get(row.id);
    if (wait && wait.nextAt > now) {
      retrying++;
      continue;
    }
    const outcome = await syncCard(row.organizationId, row.id).catch((): SyncOutcome => "retry");
    if (outcome === "done") {
      map.delete(row.id);
    } else {
      const attempts = (wait?.attempts ?? 0) + 1;
      const step = RETRY_STEPS_S[Math.min(attempts - 1, RETRY_STEPS_S.length - 1)]!;
      map.set(row.id, { attempts, nextAt: now + step * 1000 });
      retrying++;
    }
  }
  return retrying;
}

/** Cada minuto, como el latido: nunca lanza y no frena el cierre del proceso. */
export function startWalletSync(log: (line: string) => void = console.log): void {
  if (state.__walletSyncTimer !== undefined) return;
  state.__walletSyncTimer = null;
  if (!stampCardEnabled()) return;
  const timer = setInterval(() => {
    syncPending().catch((err) => log(`[stamp-card] reintento de wallet falló: ${err instanceof Error ? err.name : "Error"}`));
  }, 60_000);
  timer.unref?.();
  state.__walletSyncTimer = timer;
}
