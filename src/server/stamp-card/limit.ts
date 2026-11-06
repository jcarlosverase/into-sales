import { count } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { stampCardLimitFor } from "@/lib/stamp-card";
import { readConfigCentral } from "@/server/central/flag";
import { getPublicLicense } from "@/server/central/license";

/**
 * 1023, D12 — El tope de clientes con tarjeta sale del plan que dijo el
 * central en el último latido. Sin central o sin llave es Comunidad. No depende
 * de que el central responda ahora: se usa lo último guardado.
 */
export async function cardLimit(organizationId: string): Promise<number | null> {
  if (!readConfigCentral().active) return stampCardLimitFor(null);
  const license = await getPublicLicense(organizationId);
  return stampCardLimitFor(license?.plan?.code);
}

export async function cardUsage(organizationId: string): Promise<{ used: number; limit: number | null }> {
  const [limit, [row]] = await Promise.all([
    cardLimit(organizationId),
    getDb()
      .select({ used: count() })
      .from(schema.stampCard)
      .where(scoped(schema.stampCard.organizationId, organizationId)),
  ]);
  return { used: row?.used ?? 0, limit };
}
