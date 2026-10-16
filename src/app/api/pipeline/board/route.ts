import { todayInTz } from "@/lib/time/slots";
import { businessTimezone } from "@/server/analytics/period";
import { and, asc, eq } from "drizzle-orm";
import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { getBranding } from "@/server/branding";
import { getAssignees } from "@/server/leads/assignee";
import { getLeadScope, ownLeadCondition, seesEverything } from "@/server/leads/scope";

export const dynamic = "force-dynamic";

/** Datos completos del kanban: etapas ordenadas + tarjetas con su contacto. */
export const GET = withAuth(async (session) => {
  const db = getDb();
  const scope = getLeadScope(session);

  const stages = await db
    .select()
    .from(schema.pipelineStage)
    .where(scoped(schema.pipelineStage.organizationId, session.organizationId))
    .orderBy(asc(schema.pipelineStage.position));

  const leads = await db
    .select({
      lead: schema.lead,
      contact: schema.contact,
      conversationId: schema.conversation.id,
    })
    .from(schema.lead)
    .innerJoin(schema.contact, eq(schema.lead.contactId, schema.contact.id))
    .leftJoin(
      schema.conversation,
      and(
        eq(schema.conversation.contactId, schema.contact.id),
        eq(schema.conversation.isTest, false)
      )
    )
    .where(
      scoped(
        schema.lead.organizationId,
        session.organizationId,
        // 022 — a sales rep only sees their own cards.
        ownLeadCondition(scope)
      )
    )
    .orderBy(asc(schema.lead.position));

  const assignees = await getAssignees(leads.map((r) => r.lead.assignedUserId));

  // 022 — who a supervisor can hand a lead to: the whole team. A rep cannot
  // reassign, so they get an empty list.
  const canAssign = seesEverything(scope);
  const team = canAssign
    ? await db
        .select({ id: schema.user.id, name: schema.user.name })
        .from(schema.member)
        .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
        .where(scoped(schema.member.organizationId, session.organizationId))
        .orderBy(asc(schema.member.createdAt))
    : [];

  // La moneda del negocio viaja con el tablero: el cliente suma sus columnas y
  // necesita saber cuál es la única sumable, sin adivinarla ni pedirla aparte.
  const { currency } = await getBranding(session.organizationId);

  // 029 — hoy del negocio, para los atajos del próximo contacto.
  const today = todayInTz(new Date(), await businessTimezone(session.organizationId));

  return Response.json({
    currency,
    today,
    canAssign,
    team,
    stages: stages.map((s) => ({
      id: s.id,
      name: s.name,
      position: s.position,
      kind: s.kind,
    })),
    leads: leads.map((r) => ({
      id: r.lead.id,
      stageId: r.lead.stageId,
      position: r.lead.position,
      lastActivityAt: r.lead.lastActivityAt?.toISOString() ?? null,
      amountCents: r.lead.amountCents,
      currency: r.lead.currency,
      priority: r.lead.priority,
      followUpOn: r.lead.followUpOn,
      followUpNote: r.lead.followUpNote,
      contact: {
        id: r.contact.id,
        name: r.contact.name,
        phone: r.contact.phone,
      },
      conversationId: r.conversationId,
      assignee: r.lead.assignedUserId
        ? (assignees.get(r.lead.assignedUserId) ?? null)
        : null,
    })),
  });
});
