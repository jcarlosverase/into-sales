import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import {
  applyAdjust,
  applyRedeem,
  applyStamp,
  canStamp,
  isComplete,
} from "@/lib/stamp-card";
import { publish } from "@/server/events/bus";
import { getProgram, type StampProgram } from "./program";
import { appleAuthTokenFor, hashToken, newSerial, publicTokenFor } from "./tokens";
import { kickWalletSync } from "./wallet-sync";

export type StampCard = typeof schema.stampCard.$inferSelect;
export type StampSource = "whatsapp" | "panel" | "qr";

/** Errores del dominio que la API traduce a un código HTTP. */
export class StampCardError extends Error {
  constructor(
    readonly code: "no_program" | "program_paused" | "not_found" | "not_complete",
    message: string
  ) {
    super(message);
    this.name = "StampCardError";
  }
}

export { publicCardUrl, staffCardUrl } from "./urls";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

function notify(organizationId: string, card: StampCard) {
  publish(organizationId, { type: "stamp_card.updated", data: { cardId: card.id, contactId: card.contactId } });
  if (card.walletSyncPending) kickWalletSync(organizationId, card.id);
}

/**
 * D2 — Crea la tarjeta del contacto en el programa vivo, o devuelve la que ya
 * tiene. El único (programa, contacto) hace que dos altas a la vez terminen
 * en la misma tarjeta. Por WhatsApp hace falta el programa activo; desde la
 * ficha basta con que exista.
 */
export async function ensureCard(
  organizationId: string,
  contactId: string,
  { source, userId = null, now = new Date() }: { source: StampSource; userId?: string | null; now?: Date }
): Promise<{ card: StampCard; program: StampProgram; created: boolean }> {
  const program = await getProgram(organizationId);
  if (!program) throw new StampCardError("no_program", "Todavía no hay una tarjeta de sellos configurada");
  if (source === "whatsapp" && program.status !== "active") {
    throw new StampCardError("program_paused", "La tarjeta de sellos está en pausa");
  }
  const db = getDb();
  return db.transaction(async (tx) => {
    const [contact] = await tx
      .select({ id: schema.contact.id })
      .from(schema.contact)
      .where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, contactId)))
      .limit(1);
    if (!contact) throw new StampCardError("not_found", "Contacto no encontrado");

    const id = newId("stampCard");
    const [inserted] = await tx
      .insert(schema.stampCard)
      .values({
        id,
        organizationId,
        programId: program.id,
        contactId,
        serial: newSerial(),
        publicTokenHash: hashToken(publicTokenFor(id)),
        appleAuthTokenHash: hashToken(appleAuthTokenFor(id)),
        stampsRequired: program.stampsRequired,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: [schema.stampCard.programId, schema.stampCard.contactId] })
      .returning();
    if (inserted) {
      await tx.insert(schema.stampEvent).values({
        id: newId("stampEvent"),
        organizationId,
        cardId: inserted.id,
        kind: "join",
        delta: 0,
        stampsAfter: 0,
        source,
        userId,
        idempotencyKey: "join",
        createdAt: now,
      });
      return { card: inserted, program, created: true };
    }
    const [existing] = await tx
      .select()
      .from(schema.stampCard)
      .where(
        scoped(
          schema.stampCard.organizationId,
          organizationId,
          eq(schema.stampCard.programId, program.id),
          eq(schema.stampCard.contactId, contactId)
        )
      )
      .limit(1);
    return { card: existing!, program, created: false };
  }).then((result) => {
    if (result.created) notify(organizationId, result.card);
    return result;
  });
}

export type MutationResult =
  | { status: "ok"; card: StampCard; replayed: boolean; completed: boolean }
  | { status: "needs_confirmation"; card: StampCard; nextAt: Date };

type MutationInput = {
  userId: string | null;
  source: StampSource;
  idempotencyKey: string;
  now?: Date;
};

/**
 * Bloquea la tarjeta y, si la misma llave de idempotencia ya se usó, devuelve
 * la tarjeta tal como está sin repetir el cambio (AC5): un doble clic o un
 * reintento de red no suman dos.
 */
async function lockCard(tx: Tx, organizationId: string, cardId: string, idempotencyKey: string) {
  const [card] = await tx
    .select()
    .from(schema.stampCard)
    .where(scoped(schema.stampCard.organizationId, organizationId, eq(schema.stampCard.id, cardId)))
    .for("update")
    .limit(1);
  if (!card) throw new StampCardError("not_found", "Tarjeta no encontrada");
  const [seen] = await tx
    .select({ id: schema.stampEvent.id })
    .from(schema.stampEvent)
    .where(and(eq(schema.stampEvent.cardId, cardId), eq(schema.stampEvent.idempotencyKey, idempotencyKey)))
    .limit(1);
  const [program] = await tx
    .select()
    .from(schema.stampProgram)
    .where(scoped(schema.stampProgram.organizationId, organizationId, eq(schema.stampProgram.id, card.programId)))
    .limit(1);
  return { card, program: program!, replayed: !!seen };
}

async function writeEvent(
  tx: Tx,
  organizationId: string,
  card: StampCard,
  kind: "stamp" | "redeem" | "adjust",
  values: { delta: number; stamps: number; stampsRequired?: number; forced?: boolean; rewards?: number; lastStampAt?: Date },
  input: MutationInput,
  now: Date
): Promise<StampCard> {
  await tx.insert(schema.stampEvent).values({
    id: newId("stampEvent"),
    organizationId,
    cardId: card.id,
    kind,
    delta: values.delta,
    stampsAfter: values.stamps,
    source: input.source,
    userId: input.userId,
    forced: values.forced ?? false,
    idempotencyKey: input.idempotencyKey,
    createdAt: now,
  });
  const [updated] = await tx
    .update(schema.stampCard)
    .set({
      stamps: values.stamps,
      stampsRequired: values.stampsRequired ?? card.stampsRequired,
      rewardsRedeemed: values.rewards ?? card.rewardsRedeemed,
      lastStampAt: values.lastStampAt ?? card.lastStampAt,
      passVersion: card.passVersion + 1,
      // D9: el cambio va a los wallets después, y se reintenta si el central no responde.
      walletSyncPending: true,
      updatedAt: now,
    })
    .where(eq(schema.stampCard.id, card.id))
    .returning();
  return updated!;
}

/**
 * H4 — Suma un sello. Con el programa en pausa no se sella. Antes del mínimo
 * de horas devuelve `needs_confirmation` salvo que se confirme (`force`), y
 * el sello forzado queda marcado en la bitácora (D7).
 */
export async function addStamp(
  organizationId: string,
  cardId: string,
  input: MutationInput & { force?: boolean }
): Promise<MutationResult> {
  const now = input.now ?? new Date();
  const result = await getDb().transaction(async (tx): Promise<MutationResult> => {
    const { card, program, replayed } = await lockCard(tx, organizationId, cardId, input.idempotencyKey);
    if (replayed) return { status: "ok", card, replayed: true, completed: isComplete(card) };
    if (program.status !== "active") throw new StampCardError("program_paused", "La tarjeta de sellos está en pausa");
    const check = canStamp(card.lastStampAt, program.minHoursBetweenStamps, now);
    if (!check.ok && !input.force) return { status: "needs_confirmation", card, nextAt: check.nextAt };
    const next = applyStamp(card);
    const updated = await writeEvent(
      tx,
      organizationId,
      card,
      "stamp",
      { delta: 1, stamps: next.stamps, forced: !check.ok, lastStampAt: now },
      input,
      now
    );
    return { status: "ok", card: updated, replayed: false, completed: next.complete && !isComplete(card) };
  });
  if (result.status === "ok" && !result.replayed) {
    notify(organizationId, result.card);
    // D10: el aviso al completar va aparte; lo importa recién aquí para no
    // cargar el envío de WhatsApp en cada consulta de tarjetas.
    if (result.completed) {
      void import("./complete").then((m) => m.notifyCardComplete(organizationId, result.card.id)).catch(() => undefined);
    }
  }
  return result;
}

/** H5 — Canjea el premio: resta los sellos del ciclo y cuenta el canje (AC6). */
export async function redeemReward(organizationId: string, cardId: string, input: MutationInput): Promise<MutationResult> {
  const now = input.now ?? new Date();
  const result = await getDb().transaction(async (tx): Promise<MutationResult> => {
    const { card, program, replayed } = await lockCard(tx, organizationId, cardId, input.idempotencyKey);
    if (replayed) return { status: "ok", card, replayed: true, completed: false };
    const r = applyRedeem(card, program.stampsRequired);
    if (!r.ok) throw new StampCardError("not_complete", "La tarjeta todavía no está completa");
    const updated = await writeEvent(
      tx,
      organizationId,
      card,
      "redeem",
      { delta: r.delta, stamps: r.stamps, stampsRequired: r.stampsRequired, rewards: card.rewardsRedeemed + 1 },
      input,
      now
    );
    return { status: "ok", card: updated, replayed: false, completed: false };
  });
  if (result.status === "ok" && !result.replayed) notify(organizationId, result.card);
  return result;
}

/** D7 — Ajuste manual (solo administrador, lo exige la API). Nunca deja sellos negativos. */
export async function adjustStamps(
  organizationId: string,
  cardId: string,
  delta: number,
  input: MutationInput
): Promise<MutationResult> {
  const now = input.now ?? new Date();
  const result = await getDb().transaction(async (tx): Promise<MutationResult> => {
    const { card, replayed } = await lockCard(tx, organizationId, cardId, input.idempotencyKey);
    if (replayed) return { status: "ok", card, replayed: true, completed: false };
    const r = applyAdjust(card, delta);
    const updated = await writeEvent(tx, organizationId, card, "adjust", { delta: r.delta, stamps: r.stamps }, input, now);
    return { status: "ok", card: updated, replayed: false, completed: false };
  });
  if (result.status === "ok" && !result.replayed) notify(organizationId, result.card);
  return result;
}

export async function getCard(organizationId: string, cardId: string): Promise<StampCard | null> {
  const [card] = await getDb()
    .select()
    .from(schema.stampCard)
    .where(scoped(schema.stampCard.organizationId, organizationId, eq(schema.stampCard.id, cardId)))
    .limit(1);
  return card ?? null;
}

export async function getCardBySerial(organizationId: string, serial: string): Promise<StampCard | null> {
  const [card] = await getDb()
    .select()
    .from(schema.stampCard)
    .where(scoped(schema.stampCard.organizationId, organizationId, eq(schema.stampCard.serial, serial)))
    .limit(1);
  return card ?? null;
}

/** La tarjeta del contacto en el programa vivo, si tiene. */
export async function getCardForContact(organizationId: string, contactId: string): Promise<StampCard | null> {
  const program = await getProgram(organizationId);
  if (!program) return null;
  const [card] = await getDb()
    .select()
    .from(schema.stampCard)
    .where(
      scoped(
        schema.stampCard.organizationId,
        organizationId,
        eq(schema.stampCard.programId, program.id),
        eq(schema.stampCard.contactId, contactId)
      )
    )
    .limit(1);
  return card ?? null;
}

export type StampEventView = {
  id: string;
  kind: "join" | "stamp" | "redeem" | "adjust";
  delta: number;
  stampsAfter: number;
  source: StampSource;
  forced: boolean;
  userName: string | null;
  createdAt: Date;
};

/** La bitácora más reciente primero (AC14). */
export async function listEvents(organizationId: string, cardId: string, limit = 50): Promise<StampEventView[]> {
  return getDb()
    .select({
      id: schema.stampEvent.id,
      kind: schema.stampEvent.kind,
      delta: schema.stampEvent.delta,
      stampsAfter: schema.stampEvent.stampsAfter,
      source: schema.stampEvent.source,
      forced: schema.stampEvent.forced,
      userName: schema.user.name,
      createdAt: schema.stampEvent.createdAt,
    })
    .from(schema.stampEvent)
    .leftJoin(schema.user, eq(schema.user.id, schema.stampEvent.userId))
    .where(scoped(schema.stampEvent.organizationId, organizationId, eq(schema.stampEvent.cardId, cardId)))
    .orderBy(desc(schema.stampEvent.createdAt), desc(schema.stampEvent.id))
    .limit(limit);
}

/**
 * D5 — La tarjeta de un token público, con lo mínimo para dibujarla. Sin
 * sesión: no hay organización de la que partir, el token es la llave. Nunca
 * devuelve el contacto.
 */
export async function findPublicCard(token: string): Promise<{ card: StampCard; program: StampProgram } | null> {
  const [row] = await getDb()
    .select({ card: schema.stampCard, program: schema.stampProgram })
    .from(schema.stampCard)
    .innerJoin(schema.stampProgram, eq(schema.stampProgram.id, schema.stampCard.programId))
    .where(eq(schema.stampCard.publicTokenHash, hashToken(token)))
    .limit(1);
  return row ?? null;
}
