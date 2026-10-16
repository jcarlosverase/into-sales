import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { aiStatusOf, statusMessage } from "@/lib/ai/provider";
import { attentionHoursSchema, isWithinAttentionHours } from "@/lib/attention";
import { isValidTimeZone } from "@/lib/time/slots";
import { resolveAttention } from "@/server/ai/attention";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, session.organizationId))
    .limit(1);
  const p = rows[0];
  if (!p) return apiError(404, "not_found", "Perfil del agente no encontrado");
  const status = await aiStatusOf(session.organizationId);
  // 031 — El horario efectivo (con sus defaults) y si ahora es horario de atención.
  const attention = await resolveAttention(session.organizationId, p);
  return Response.json({
    profile: {
      enabled: p.enabled,
      name: p.name,
      tone: p.tone,
      instructions: p.instructions,
      escalationRules: p.escalationRules,
      greeting: p.greeting,
      replyMode: p.replyMode,
      attentionHours: attention.hours,
      attentionTimezone: attention.timezone,
    },
    attentionNow: isWithinAttentionHours(new Date(), attention.hours, attention.timezone),
    aiConfigured: status.active,
    // Por qué no (sin configurar, llave rechazada, sin saldo): la pantalla
    // Agente lo dice con el enlace a Ajustes → IA.
    aiMessage: statusMessage(status),
  });
});

const putSchema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().trim().min(1).max(60).optional(),
  tone: z.string().max(500).nullable().optional(),
  instructions: z.string().max(8000).nullable().optional(),
  escalationRules: z.string().max(4000).nullable().optional(),
  greeting: z.string().max(1000).nullable().optional(),
  // 031 — Cuándo responde la IA y el horario de atención (AC1).
  replyMode: z.enum(["always", "outside_hours"]).optional(),
  attentionHours: attentionHoursSchema.optional(),
  attentionTimezone: z.string().refine(isValidTimeZone, "Zona horaria desconocida").optional(),
});

export const PUT = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const updated = await db
    .update(schema.agentProfile)
    .set({ ...body.data, updatedAt: new Date() })
    .where(scoped(schema.agentProfile.organizationId, session.organizationId))
    .returning();
  if (!updated[0]) return apiError(404, "not_found", "Perfil no encontrado");
  return Response.json({ ok: true });
});
