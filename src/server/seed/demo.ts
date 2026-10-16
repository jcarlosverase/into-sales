import { eq } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { schema } from "@/lib/db";
import { academy } from "@/server/seed/industries/academy";
import { seedIndustry } from "@/server/seed/industry";

/**
 * Demo business (FR-075): the inbox's "Cargar datos de demostración" button
 * and `pnpm seed:demo`.
 *
 * 023 — It used to be a Mexican hardware store; IntoSales loads the academy
 * sample instead (the industry of the first pilot). Same rules as
 * `pnpm seed:academy`: safe to repeat and never touches real data.
 */

type Db = ReturnType<typeof getDb>;

export async function seedDemo(
  db: Db,
  organizationId: string
): Promise<{ contacts: number; kbEntries: number; businessName: string }> {
  const result = await seedIndustry(db, organizationId, academy);
  return {
    contacts: result.contacts,
    kbEntries: result.knowledgeAdded,
    businessName: academy.businessName,
  };
}

/** true si la organización aún no tiene datos de dominio (para el botón). */
export async function isDomainEmpty(
  db: Db,
  organizationId: string
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.contact.id })
    .from(schema.contact)
    .where(eq(schema.contact.organizationId, organizationId))
    .limit(1);
  return rows.length === 0;
}
