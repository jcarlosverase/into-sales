import { z } from "zod";

/**
 * 031 — Horario de atención: cuándo hay alguien del equipo en la Bandeja. Con
 * `reply_mode = outside_hours`, la IA calla dentro de este horario. Puro: lo
 * usan la puerta del turno, la API y la pantalla.
 */

export const ATTENTION_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type AttentionDay = (typeof ATTENTION_DAYS)[number];
export type AttentionInterval = { start: string; end: string };
export type AttentionHours = Partial<Record<AttentionDay, AttentionInterval[]>>;

export const DAY_LABELS: Record<AttentionDay, string> = {
  mon: "Lunes",
  tue: "Martes",
  wed: "Miércoles",
  thu: "Jueves",
  fri: "Viernes",
  sat: "Sábado",
  sun: "Domingo",
};

/** D2 — Lunes a viernes de 09:00 a 18:00. */
export const DEFAULT_ATTENTION_HOURS: AttentionHours = Object.fromEntries(
  ATTENTION_DAYS.slice(0, 5).map((d) => [d, [{ start: "09:00", end: "18:00" }]])
);

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Usa HH:MM");
const interval = z
  .object({ start: hhmm, end: z.union([hhmm, z.literal("24:00")]) })
  .refine((i) => i.start < i.end, "El inicio va antes del fin");

/** AC1 — Días `mon`…`sun`, cada uno con tramos `HH:MM` de inicio menor que el fin. */
export const attentionHoursSchema = z
  .object(Object.fromEntries(ATTENTION_DAYS.map((d) => [d, z.array(interval).max(4).optional()])) as Record<AttentionDay, z.ZodOptional<z.ZodArray<typeof interval>>>)
  .strict();

const partsFormat = new Map<string, Intl.DateTimeFormat>();
function localParts(now: Date, timezone: string): { day: AttentionDay; time: string } {
  let f = partsFormat.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    partsFormat.set(timezone, f);
  }
  const map: Record<string, string> = {};
  for (const p of f.formatToParts(now)) map[p.type] = p.value;
  const day = (map.weekday ?? "Mon").slice(0, 3).toLowerCase() as AttentionDay;
  return { day, time: `${map.hour}:${map.minute}` };
}

/** ¿`now` cae dentro del horario de atención, en su zona? El inicio cuenta; el fin no. */
export function isWithinAttentionHours(now: Date, hours: AttentionHours, timezone: string): boolean {
  const { day, time } = localParts(now, timezone);
  return (hours[day] ?? []).some((i) => i.start <= time && time < i.end);
}
