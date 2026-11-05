import { eq, ne } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import {
  DEFAULT_JOIN_PHRASE,
  DEFAULT_JOIN_REPLY,
  type ProgramInput,
} from "@/lib/stamp-card";
import { getBranding } from "@/server/branding";

export type StampProgram = typeof schema.stampProgram.$inferSelect;

/** El programa vivo (no archivado) de la organización, o null (D3). */
export async function getProgram(organizationId: string): Promise<StampProgram | null> {
  const [row] = await getDb()
    .select()
    .from(schema.stampProgram)
    .where(scoped(schema.stampProgram.organizationId, organizationId, ne(schema.stampProgram.status, "archived")))
    .limit(1);
  return row ?? null;
}

/** Lo que propone la pantalla antes del primer guardado: el nombre y el acento de la marca. */
export async function programDefaults(organizationId: string): Promise<ProgramInput> {
  const branding = await getBranding(organizationId);
  return {
    name: branding.name.slice(0, 40),
    stampsRequired: 10,
    reward: "1 producto gratis",
    terms: null,
    color: branding.accent,
    minHoursBetweenStamps: 0,
    joinPhrase: DEFAULT_JOIN_PHRASE,
    joinReply: DEFAULT_JOIN_REPLY,
    status: "active",
  };
}

/**
 * Crea o actualiza el programa. Cada guardado sube `version` (la clase de
 * Google se actualiza por versión, corte 3). Cambiar los sellos no toca las
 * tarjetas en curso: cada una guarda los suyos hasta su canje (D3).
 */
export async function saveProgram(organizationId: string, input: ProgramInput): Promise<StampProgram> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(schema.stampProgram)
      .where(scoped(schema.stampProgram.organizationId, organizationId, ne(schema.stampProgram.status, "archived")))
      .for("update")
      .limit(1);
    if (!current) {
      const [created] = await tx
        .insert(schema.stampProgram)
        .values({ id: newId("stampProgram"), organizationId, ...input })
        .returning();
      return created!;
    }
    const [updated] = await tx
      .update(schema.stampProgram)
      .set({ ...input, version: current.version + 1, updatedAt: new Date() })
      .where(scoped(schema.stampProgram.organizationId, organizationId, eq(schema.stampProgram.id, current.id)))
      .returning();
    return updated!;
  });
}

/**
 * El número de WhatsApp del negocio en dígitos, para el enlace `wa.me` del
 * cartel del mostrador y del sticker NFC (H1). Null si no hay número conectado.
 */
export async function businessWhatsAppDigits(organizationId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ display: schema.metaCredentials.displayPhoneNumber })
    .from(schema.metaCredentials)
    .where(scoped(schema.metaCredentials.organizationId, organizationId))
    .limit(1);
  const digits = row?.display?.replace(/\D/g, "") ?? "";
  return digits.length >= 8 ? digits : null;
}
