import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { publish } from "@/server/events/bus";
import { moveLeadToStage } from "@/server/leads/stage-history";
import { getBranding } from "@/server/branding";
import { isSupervisor } from "@/lib/auth/roles";
import { canSeeLead, getLeadScope } from "@/server/leads/scope";
import { isIsoDay } from "@/lib/today";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  /**
   * Opcionales desde que el lead tiene monto: capturar dinero es un gesto
   * distinto de mover la tarjeta, y exigir la etapa para guardar un importe
   * obligaría al cliente a reenviar dónde estaba —con el riesgo de moverlo sin
   * querer si el tablero venía desfasado—. Sin `stageId` no se mueve nada.
   */
  stageId: z.string().min(1).optional(),
  position: z.number().int().min(0).optional(),
  /**
   * Obligatorio al ENTRAR a una etapa perdida. No se valida aquí sino en la
   * puerta: la regla es del dominio, no de esta ruta, y hay más caminos que
   * mueven tarjetas.
   */
  lossReason: z
    .enum([
      "precio",
      "no_es_perfil",
      "sin_presupuesto",
      "eligio_otro",
      "nunca_contesto",
      "otro",
    ])
    .optional(),
  lossNote: z.string().max(500).optional(),
  /**
   * Monto en centavos enteros. `null` explícito lo borra; ausente lo deja como
   * estaba — capturar el monto y mover la tarjeta son dos gestos distintos y
   * uno no debe pisar al otro.
   */
  amountCents: z.number().int().min(0).max(1_000_000_000_00).nullable().optional(),
  currency: z.string().length(3).nullable().optional(),
  /** `null` explícito la quita; ausente la deja como estaba. */
  priority: z.enum(["alta", "media", "baja"]).nullable().optional(),
  /**
   * 022 — Hand the lead to a team member; `null` leaves it unassigned. Only
   * supervisors can do it, and it does not move the rotation (D7).
   */
  assignedUserId: z.string().min(1).nullable().optional(),
  /**
   * 029 — Day of the next follow-up (`AAAA-MM-DD`, business calendar) and its
   * note. `null` clears; absent leaves them as they were.
   */
  followUpOn: z
    .string()
    .refine(isIsoDay, "Fecha inválida: usa AAAA-MM-DD")
    .nullable()
    .optional(),
  followUpNote: z.string().trim().max(200).nullable().optional(),
});

/** 022 — Is `userId` part of this organization's team (any role)? */
async function isTeamMember(organizationId: string, userId: string) {
  const rows = await getDb()
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(
      scoped(schema.member.organizationId, organizationId, eq(schema.member.userId, userId))
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * 022 — After a reassignment the lead's conversation must show up in the new
 * owner's inbox (and leave the old one's). Touching `updated_at` makes the
 * inbox's `since=` catch-up include it; the event refreshes open screens.
 */
async function announceReassignment(organizationId: string, contactId: string) {
  const db = getDb();
  const touched = await db
    .update(schema.conversation)
    .set({ updatedAt: new Date() })
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.contactId, contactId),
        eq(schema.conversation.isTest, false)
      )
    )
    .returning({ id: schema.conversation.id });
  for (const c of touched) {
    publish(organizationId, {
      type: "conversation.updated",
      data: { conversation: { id: c.id } },
    });
  }
}

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  // 022 — someone else's lead does not exist for a sales rep (D8).
  if (!(await canSeeLead(getLeadScope(session), session.organizationId, id))) {
    return apiError(404, "not_found", "Lead no encontrado");
  }

  // El monto viaja en el MISMO update que el movimiento: capturarlo mientras
  // se arrastra la tarjeta no debe costar dos viajes ni dejar un estado a
  // medias si el segundo falla.
  const extra: Record<string, unknown> = {};
  if (body.data.amountCents !== undefined) {
    extra.amountCents = body.data.amountCents;
    // Sin monto no hay moneda que guardar: dejarla apuntando a un importe
    // borrado haría que el tablero contara un lead que ya no tiene número.
    extra.currency =
      body.data.amountCents === null
        ? null
        : (body.data.currency ?? (await getBranding(session.organizationId)).currency);
  }

  const reassigning = body.data.assignedUserId !== undefined;
  if (reassigning) {
    if (!isSupervisor(session.role)) {
      return apiError(403, "forbidden", "Solo un supervisor puede reasignar leads");
    }
    const assignedUserId = body.data.assignedUserId ?? null;
    if (assignedUserId && !(await isTeamMember(session.organizationId, assignedUserId))) {
      return apiError(422, "invalid_assignee", "Ese usuario no es del equipo");
    }
    extra.assignedUserId = assignedUserId;
    extra.assignedAt = assignedUserId ? new Date() : null;
  }

  // 029 — Next follow-up. An empty note is no note.
  if (body.data.followUpOn !== undefined) extra.followUpOn = body.data.followUpOn;
  if (body.data.followUpNote !== undefined) extra.followUpNote = body.data.followUpNote || null;

  if (body.data.priority !== undefined) {
    extra.priority = body.data.priority;
    // La fecha acompaña al valor: sirve para saber si la decisión es de hoy o
    // de hace tres semanas, que es lo que vuelve útil mirarla.
    extra.priorityUpdatedAt = body.data.priority === null ? null : new Date();
  }

  // Sin etapa: solo se actualizan los campos del lead. No pasa por la puerta
  // de la bitácora porque no hay movimiento que registrar — y el guardarraíl
  // sigue contento: aquí jamás se escribe `stageId`.
  if (!body.data.stageId) {
    if (Object.keys(extra).length === 0) {
      return apiError(422, "nothing_to_update", "No hay nada que actualizar");
    }
    const db = getDb();
    const updated = await db
      .update(schema.lead)
      .set({ ...extra, updatedAt: new Date() })
      .where(
        scoped(
          schema.lead.organizationId,
          session.organizationId,
          eq(schema.lead.id, id)
        )
      )
      .returning();
    if (!updated[0]) return apiError(404, "not_found", "Lead no encontrado");
    if (reassigning) {
      await announceReassignment(session.organizationId, updated[0].contactId);
    }
    return Response.json({ lead: updated[0] });
  }

  const res = await moveLeadToStage({
    organizationId: session.organizationId,
    leadId: id,
    toStageId: body.data.stageId,
    position: body.data.position,
    actorUserId: session.userId,
    source: "dueno",
    lossReason: body.data.lossReason ?? null,
    lossNote: body.data.lossNote ?? null,
    extra,
  });

  if (!res.ok) {
    if (res.reason === "lead_not_found") {
      return apiError(404, "not_found", "Lead no encontrado");
    }
    if (res.reason === "stage_not_found") {
      return apiError(422, "invalid_stage", "Etapa inexistente");
    }
    // El tablero abre su diálogo con este código: perder un trato sin decir
    // por qué deja el embudo sin la mitad que importa.
    return apiError(
      422,
      "loss_reason_required",
      "Falta el motivo de la pérdida"
    );
  }

  if (reassigning) {
    await announceReassignment(session.organizationId, res.lead.contactId);
  }

  const db = getDb();
  // Notifica a la bandeja para que la etapa se refleje en vivo (panel de
  // detalles y punto de etapa de la lista) sin recargar.
  const convRows = await db
    .select({ id: schema.conversation.id })
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, session.organizationId),
        eq(schema.conversation.contactId, res.lead.contactId),
        eq(schema.conversation.isTest, false)
      )
    )
    .limit(1);
  if (convRows[0]) {
    publish(session.organizationId, {
      type: "conversation.updated",
      data: { conversation: { id: convRows[0].id } },
    });
  }

  return Response.json({ lead: res.lead });
});
