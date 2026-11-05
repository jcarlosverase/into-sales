import { and, count, eq, gte, lt, or, sql, exists } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { comparable, type StampCardBlockDto } from "@/lib/analytics";
import type { ResolvedPeriod } from "@/server/analytics/period";
import { notLabContact } from "@/server/analytics/shared";

/**
 * 1023, AC12 — La tarjeta de sellos del periodo, contra el periodo anterior:
 * tarjetas nuevas, sellos, canjes y clientes que volvieron. Las tarjetas en
 * un wallet describen el ahora. El Laboratorio no cuenta (spec 019, D6).
 */
export async function stampCardBlock(organizationId: string, period: ResolvedPeriod): Promise<StampCardBlockDto> {
  const [now, before, totals] = await Promise.all([
    periodCounts(organizationId, period.start, period.end),
    periodCounts(organizationId, period.previousStart, period.previousEnd),
    currentTotals(organizationId),
  ]);
  return {
    period: period.dto,
    newCards: comparable(now.newCards, before.newCards),
    stamps: comparable(now.stamps, before.stamps),
    redeems: comparable(now.redeems, before.redeems),
    returning: comparable(now.returning, before.returning),
    inWallet: totals.inWallet,
    totalCards: totals.total,
    empty: totals.total === 0,
  };
}

async function periodCounts(organizationId: string, start: Date, end: Date) {
  const db = getDb();
  const card = schema.stampCard;
  const event = schema.stampEvent;
  const [[cards], [events], [returning]] = await Promise.all([
    db
      .select({ n: count() })
      .from(card)
      .where(scoped(card.organizationId, organizationId, gte(card.createdAt, start), lt(card.createdAt, end), notLabContact(card.contactId))),
    db
      .select({
        stamps: sql<number>`count(*) filter (where ${event.kind} = 'stamp')`.mapWith(Number),
        redeems: sql<number>`count(*) filter (where ${event.kind} = 'redeem')`.mapWith(Number),
      })
      .from(event)
      .innerJoin(card, eq(card.id, event.cardId))
      .where(scoped(event.organizationId, organizationId, gte(event.createdAt, start), lt(event.createdAt, end), notLabContact(card.contactId))),
    db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(
        db
          .select({ cardId: event.cardId })
          .from(event)
          .innerJoin(card, eq(card.id, event.cardId))
          .where(
            scoped(
              event.organizationId,
              organizationId,
              eq(event.kind, "stamp"),
              gte(event.createdAt, start),
              lt(event.createdAt, end),
              notLabContact(card.contactId)
            )
          )
          .groupBy(event.cardId)
          .having(sql`count(*) >= 2`)
          .as("returning_cards")
      ),
  ]);
  return {
    newCards: cards?.n ?? 0,
    stamps: events?.stamps ?? 0,
    redeems: events?.redeems ?? 0,
    returning: returning?.n ?? 0,
  };
}

async function currentTotals(organizationId: string) {
  const db = getDb();
  const card = schema.stampCard;
  const [row] = await db
    .select({
      total: count(),
      inWallet: sql<number>`count(*) filter (where ${or(
        eq(card.googleObjectSaved, true),
        exists(
          db
            .select({ one: sql`1` })
            .from(schema.applePassRegistration)
            .where(and(eq(schema.applePassRegistration.cardId, card.id)))
        )
      )})`.mapWith(Number),
    })
    .from(card)
    .where(scoped(card.organizationId, organizationId, notLabContact(card.contactId)));
  return { total: row?.total ?? 0, inWallet: row?.inWallet ?? 0 };
}
