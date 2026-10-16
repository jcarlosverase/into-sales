import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { newId } from "@/lib/db/ids";
import { buildEventForget } from "@/server/brains/contract";
import { notifyForget, type ResultForget } from "@/server/brains/deliver";
import { businessTimezone } from "@/server/analytics/period";
import { publish } from "@/server/events/bus";
import { canSeeConversation, getLeadScope } from "@/server/leads/scope";
import { deleteConversation } from "@/server/inbox/delete-conversation";
import { serializeConversation, getConversation, updateConversation } from "@/server/inbox/queries";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  aiEnabled: z.boolean().optional(),
  reactivate: z.boolean().optional(),
  markRead: z.boolean().optional(),
});

type Params = { params: Promise<{ id: string }> };

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  if (!(await canSeeConversation(getLeadScope(session), session.organizationId, id))) {
    return apiError(404, "not_found", "Conversación no encontrada");
  }
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  const updated = await updateConversation(session.organizationId, id, body.data);
  if (!updated) return apiError(404, "not_found", "Conversación no encontrada");

  const row = await getConversation(session.organizationId, id);
  if (row) {
    const dto = serializeConversation(
      row.conversation,
      row.contact,
      null,
      null,
      row.ad
    );
    publish(session.organizationId, {
      type: "conversation.updated",
      data: { conversation: dto },
    });
    return Response.json({ conversation: dto });
  }
  return Response.json({ conversation: null });
});

// En la zona del negocio (America/Lima por defecto): el servidor corre en UTC y
// una cita de la noche saldría con la fecha del día siguiente.
const bookingDate = (when: Date, timeZone: string) =>
  new Intl.DateTimeFormat("es-PE", { dateStyle: "long", timeZone }).format(when);

/**
 * 026 — Elimina la conversación y le pide al cerebro que la olvide.
 *
 * `?contacto=1` se lleva además a la persona: contacto, lead y citas pasadas.
 * Es irreversible en los dos casos, y por eso exige rol de configuración
 * (propietario o administrador) y no solo operar la bandeja.
 */
export const DELETE = withAuth(async (session, req: Request, ctx: Params) => {
  if (!canConfigure(session.role)) {
    return apiError(
      403,
      "forbidden",
      "Solo quien administra el negocio puede eliminar conversaciones"
    );
  }
  const { id } = await ctx.params;
  const scope =
    new URL(req.url).searchParams.get("contacto") === "1" ? "contacto" : "hilo";

  const result = await deleteConversation(session.organizationId, id, scope);
  if (!result.ok) {
    if (result.reason === "cita_pendiente") {
      return apiError(
        409,
        "cita_pendiente",
        `Tiene una cita agendada para el ${bookingDate(result.when, await businessTimezone(session.organizationId))}. Cancélala en Citas antes de eliminar.`
      );
    }
    return apiError(404, "not_found", "Conversación no encontrada");
  }

  // Irreversible y sin papelera: que al menos quede quién y cuándo. Solo ids.
  console.info(
    `[bandeja] ${session.userId} eliminó ${id} (${scope}) en ${session.organizationId}`
  );

  // El aviso va DESPUÉS del borrado y no lo condiciona: lo que se pidió ya
  // pasó, y un cerebro caído no puede dejar la conversación en la bandeja.
  let agent: ResultForget = "no_aplica";
  const deletedAt = new Date();
  for (const conversation of result.conversations) {
    const notice = await notifyForget(
      buildEventForget({
        eventId: newId("forget"),
        organization: result.organization,
        conversation: conversation,
        contact: result.contact,
        deletedAt,
      })
    );
    if (notice === "sin_confirmar" || agent === "no_aplica") agent = notice;
  }

  for (const conversation of result.conversations) {
    publish(session.organizationId, {
      type: "conversation.deleted",
      data: {
        conversationId: conversation.id,
        contactId: result.contact.id,
        contactDeleted: scope === "contacto",
      },
    });
  }
  return Response.json({ ok: true, scope: scope, agent: agent });
});
