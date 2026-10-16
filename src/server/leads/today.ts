import { and, asc, eq, isNull, lt, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { todayInTz } from "@/lib/time/slots";
import { sortSection, TODAY_SECTION_LABELS, type Priority, type TodaySectionId } from "@/lib/today";
import { businessTimezone } from "@/server/analytics/period";
import { notLabContact } from "@/server/analytics/shared";
import { ownLeadCondition, type LeadScope } from "@/server/leads/scope";

/**
 * 029 — «A quién llamar hoy». Solo leads abiertos, de contactos no archivados
 * y fuera del Laboratorio (D3), con el alcance de la 022 (D4).
 */

export const TODAY_LIMIT = 200;

export type TodayItem = {
  leadId: string;
  contactId: string;
  name: string;
  phone: string | null;
  conversationId: string | null;
  priority: Priority | null;
  followUpOn: string | null;
  followUpNote: string | null;
  stageName: string;
  assignee: { id: string; name: string } | null;
  createdAt: string;
};

export type TodaySection = { id: TodaySectionId; label: string; total: number; items: TodayItem[] };

/** Supervisors only: who to look at. Reps always get their own (D4). */
export type TodayFilter = { kind: "all" } | { kind: "unassigned" } | { kind: "user"; userId: string };

export type TodayList = { today: string; timezone: string; sections: TodaySection[] };

/** The business never wrote to this contact (no outbound message in a real conversation). */
const neverContacted = sql`not exists (
  select 1 from "message" m join "conversation" c on c."id" = m."conversation_id"
  where c."contact_id" = ${schema.lead.contactId} and c."is_test" = false and m."direction" = 'out'
)`;

function filterCondition(scope: LeadScope, filter: TodayFilter): SQL | undefined {
  if (scope.kind !== "all") return ownLeadCondition(scope);
  if (filter.kind === "unassigned") return isNull(schema.lead.assignedUserId);
  if (filter.kind === "user") return eq(schema.lead.assignedUserId, filter.userId);
  return undefined;
}

export async function todayList(
  organizationId: string,
  scope: LeadScope,
  filter: TodayFilter = { kind: "all" },
  now: Date = new Date()
): Promise<TodayList> {
  const timezone = await businessTimezone(organizationId);
  const today = todayInTz(now, timezone);
  const who = filterCondition(scope, filter);

  const section = async (id: TodaySectionId, rule: SQL | undefined): Promise<TodaySection> => {
    const rows = await getDb()
      .select({
        leadId: schema.lead.id,
        contactId: schema.contact.id,
        name: schema.contact.name,
        phone: schema.contact.phone,
        priority: schema.lead.priority,
        followUpOn: schema.lead.followUpOn,
        followUpNote: schema.lead.followUpNote,
        stageName: schema.pipelineStage.name,
        assigneeId: schema.user.id,
        assigneeName: schema.user.name,
        createdAt: schema.lead.createdAt,
        conversationId: sql<string | null>`(
          select c."id" from "conversation" c
          where c."contact_id" = ${schema.lead.contactId} and c."is_test" = false
          order by c."last_message_at" desc nulls last limit 1
        )`,
        total: sql<number>`(count(*) over ())::int`,
      })
      .from(schema.lead)
      .innerJoin(schema.contact, eq(schema.contact.id, schema.lead.contactId))
      .innerJoin(schema.pipelineStage, eq(schema.pipelineStage.id, schema.lead.stageId))
      .leftJoin(schema.user, eq(schema.user.id, schema.lead.assignedUserId))
      .where(
        scoped(
          schema.lead.organizationId,
          organizationId,
          eq(schema.pipelineStage.kind, "open"),
          isNull(schema.contact.archivedAt),
          notLabContact(schema.lead.contactId),
          who,
          rule
        )
      )
      .orderBy(asc(schema.lead.followUpOn), asc(schema.lead.createdAt))
      .limit(TODAY_LIMIT);

    const items: TodayItem[] = rows.map((r) => ({
      leadId: r.leadId,
      contactId: r.contactId,
      name: r.name,
      phone: r.phone,
      conversationId: r.conversationId,
      priority: r.priority,
      followUpOn: r.followUpOn,
      followUpNote: r.followUpNote,
      stageName: r.stageName,
      assignee: r.assigneeId && r.assigneeName ? { id: r.assigneeId, name: r.assigneeName } : null,
      createdAt: r.createdAt.toISOString(),
    }));
    return { id, label: TODAY_SECTION_LABELS[id], total: rows[0]?.total ?? 0, items: sortSection(id, items) };
  };

  const sections = await Promise.all([
    section("overdue", lt(schema.lead.followUpOn, today)),
    section("today", eq(schema.lead.followUpOn, today)),
    section("first_contact", and(isNull(schema.lead.followUpOn), neverContacted)),
  ]);
  return { today, timezone, sections };
}
