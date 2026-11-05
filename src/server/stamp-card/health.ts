import { and, count, eq, lt } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

export type StampCardStuck = { count: number };

/** Tarjetas con cambios pendientes de pasar a los wallets hace más de una hora (D9). */
export async function stampCardStuck(organizationId: string, now: Date = new Date()): Promise<StampCardStuck> {
  const hourAgo = new Date(now.getTime() - 3_600_000);
  const [row] = await getDb()
    .select({ n: count() })
    .from(schema.stampCard)
    .where(
      scoped(
        schema.stampCard.organizationId,
        organizationId,
        and(eq(schema.stampCard.walletSyncPending, true), lt(schema.stampCard.updatedAt, hourAgo))
      )
    );
  return { count: row?.n ?? 0 };
}
