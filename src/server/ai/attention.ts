import { DEFAULT_ATTENTION_HOURS, attentionHoursSchema, isWithinAttentionHours, type AttentionHours } from "@/lib/attention";
import { isValidTimeZone } from "@/lib/time/slots";
import { businessTimezone } from "@/server/analytics/period";

/**
 * 031 — El horario de atención efectivo de una organización: lo guardado en el
 * perfil del agente o los valores por defecto (D2). Un JSON dañado en la base
 * no tumba el turno: cae al horario por defecto.
 */
export async function resolveAttention(
  organizationId: string,
  profile: { attentionHours: unknown; attentionTimezone: string | null }
): Promise<{ hours: AttentionHours; timezone: string }> {
  const parsed = attentionHoursSchema.safeParse(profile.attentionHours);
  const hours = profile.attentionHours != null && parsed.success ? (parsed.data as AttentionHours) : DEFAULT_ATTENTION_HOURS;
  const timezone =
    profile.attentionTimezone && isValidTimeZone(profile.attentionTimezone)
      ? profile.attentionTimezone
      : await businessTimezone(organizationId);
  return { hours, timezone };
}

/**
 * D1, D3 — ¿Calla la IA ahora? Solo con `outside_hours` y dentro del horario.
 * El Laboratorio no pregunta (D4): eso lo decide quien llama.
 */
export async function silencedByAttentionHours(
  organizationId: string,
  profile: { replyMode: "always" | "outside_hours"; attentionHours: unknown; attentionTimezone: string | null },
  now: Date = new Date()
): Promise<boolean> {
  if (profile.replyMode !== "outside_hours") return false;
  const { hours, timezone } = await resolveAttention(organizationId, profile);
  return isWithinAttentionHours(now, hours, timezone);
}
