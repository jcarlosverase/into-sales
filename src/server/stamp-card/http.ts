import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isComplete, stampsLeft } from "@/lib/stamp-card";
import { listEvents, publicCardUrl, staffCardUrl, StampCardError, type StampCard, type StampEventView } from "./cards";
import type { StampProgram } from "./program";

/**
 * 1023 — Lo que la API del panel devuelve de una tarjeta y cómo traduce los
 * errores del dominio. Las rutas solo exportan handlers (AGENTS.md).
 */

export type CardView = {
  id: string;
  contactId: string;
  contactName: string;
  serial: string;
  stamps: number;
  stampsRequired: number;
  stampsLeft: number;
  complete: boolean;
  rewardsRedeemed: number;
  lastStampAt: string | null;
  inWallet: boolean;
  /** D13 — Cuándo aceptó guardarla en su celular. */
  consentAt: string | null;
  publicUrl: string;
  staffUrl: string;
  program: { name: string; reward: string; status: string; color: string; minHoursBetweenStamps: number };
  events?: (Omit<StampEventView, "createdAt"> & { createdAt: string })[];
};

export async function cardView(
  organizationId: string,
  card: StampCard,
  { withEvents = false }: { withEvents?: boolean } = {}
): Promise<CardView> {
  const db = getDb();
  const [[contact], [program], registrations] = await Promise.all([
    db
      .select({ name: schema.contact.name })
      .from(schema.contact)
      .where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, card.contactId)))
      .limit(1),
    db
      .select()
      .from(schema.stampProgram)
      .where(scoped(schema.stampProgram.organizationId, organizationId, eq(schema.stampProgram.id, card.programId)))
      .limit(1),
    db
      .select({ id: schema.applePassRegistration.id })
      .from(schema.applePassRegistration)
      .where(scoped(schema.applePassRegistration.organizationId, organizationId, eq(schema.applePassRegistration.cardId, card.id)))
      .limit(1),
  ]);
  const p = program as StampProgram;
  const view: CardView = {
    id: card.id,
    contactId: card.contactId,
    contactName: contact?.name ?? "",
    serial: card.serial,
    stamps: card.stamps,
    stampsRequired: card.stampsRequired,
    stampsLeft: stampsLeft(card),
    complete: isComplete(card),
    rewardsRedeemed: card.rewardsRedeemed,
    lastStampAt: card.lastStampAt?.toISOString() ?? null,
    inWallet: card.googleObjectSaved || registrations.length > 0,
    consentAt: card.consentAt?.toISOString() ?? null,
    publicUrl: publicCardUrl(card.id),
    staffUrl: staffCardUrl(card.serial),
    program: {
      name: p.name,
      reward: p.reward,
      status: p.status,
      color: p.color,
      minHoursBetweenStamps: p.minHoursBetweenStamps,
    },
  };
  if (withEvents) {
    view.events = (await listEvents(organizationId, card.id)).map((e) => ({ ...e, createdAt: e.createdAt.toISOString() }));
  }
  return view;
}

export function stampCardErrorResponse(err: unknown): Response {
  if (err instanceof StampCardError) {
    const status = err.code === "not_found" ? 404 : 409;
    return apiError(status, err.code, err.message);
  }
  throw err;
}

/** AC5 — la llave de idempotencia viene en la cabecera; sin ella, 422. */
const idempotencySchema = z.string().trim().min(8).max(100);

export function idempotencyKeyOf(req: Request): { ok: true; key: string } | { ok: false; response: Response } {
  const parsed = idempotencySchema.safeParse(req.headers.get("idempotency-key") ?? "");
  return parsed.success
    ? { ok: true, key: parsed.data }
    : { ok: false, response: apiError(422, "missing_idempotency_key", "Falta la cabecera Idempotency-Key (8 a 100 caracteres)") };
}
