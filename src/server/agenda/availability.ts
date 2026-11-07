import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  addDaysISO,
  eachDateInRange,
  expandWorkingDayToUtc,
  labelInTz,
  overlaps,
  todayInTz,
  weekdayKeyOf,
  zonedWallClockToUtc,
  type SlotUtc,
} from "@/lib/time/slots";
import { getSettings, type CalendarSettings } from "@/server/agenda/settings";
import {
  listActiveResources,
  type AgendaResource,
  type Reader,
} from "@/server/agenda/resources";

/**
 * 015 — Motor de disponibilidad:
 *   horario semanal del negocio − citas activas − bloqueos manuales.
 *
 * Limitación v1 documentada (Constitución VII): NO lee calendarios externos.
 * Es una decisión, no un olvido: meter al proveedor en este camino acoplaría su
 * latencia y sus caídas a la pantalla que más se usa. Los compromisos de fuera
 * se reflejan con bloqueos manuales.
 */

export type AvailableSlot = SlotUtc & {
  label: string;
  /** 1029 — Quién está libre en ese instante; vacío sin profesionales. */
  resourceIds?: string[];
};

type BusyInterval = SlotUtc & { resourceId: string | null };

/**
 * PURA: expande el horario semanal a slots candidatos en UTC. Sin BD, sin
 * reloj — se testea sola (tests/unit/availability.test.ts).
 */
export function buildCandidateSlots(
  settings: CalendarSettings,
  fromISO: string,
  toISO: string,
  /** 1029 — El horario de un profesional; sin él, el del negocio. */
  weeklyHours: CalendarSettings["weeklyHours"] = settings.weeklyHours
): SlotUtc[] {
  const tz = settings.timezone;
  const candidates: SlotUtc[] = [];
  for (const date of eachDateInRange(fromISO, toISO)) {
    const weekday = weekdayKeyOf(date, tz);
    if (!weekday) continue;
    const intervals = weeklyHours[weekday] ?? [];
    if (intervals.length === 0) continue; // día cerrado
    candidates.push(
      ...expandWorkingDayToUtc(
        date,
        intervals,
        tz,
        settings.slotMinutes,
        settings.bufferMinutes
      )
    );
  }
  return candidates;
}

/**
 * PURA: descarta lo que ya pasó (con aviso mínimo) y lo que se solapa con algo
 * ocupado, ordena y etiqueta.
 */
export function filterFreeSlots(
  candidates: SlotUtc[],
  busy: SlotUtc[],
  opts: { now: Date; minNoticeHours: number; timezone: string }
): AvailableSlot[] {
  return freeCandidates(candidates, busy, opts)
    .sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc))
    .map((c) => ({ ...c, label: labelInTz(c.startUtc, opts.timezone) }));
}

function freeCandidates(
  candidates: SlotUtc[],
  busy: SlotUtc[],
  opts: { now: Date; minNoticeHours: number }
): SlotUtc[] {
  const minStartMs = opts.now.getTime() + opts.minNoticeHours * 3_600_000;
  return candidates
    .filter((c) => Date.parse(c.startUtc) >= minStartMs)
    .filter(
      (c) =>
        !busy.some((b) => overlaps(c.startUtc, c.endUtc, b.startUtc, b.endUtc))
    );
}

/**
 * PURA: 1029 — Las horas de un profesional dentro de las del negocio: su horario
 * no puede salirse del horario general.
 */
export function intersectWeeklyHours(
  own: CalendarSettings["weeklyHours"],
  limit: CalendarSettings["weeklyHours"]
): CalendarSettings["weeklyHours"] {
  const out: CalendarSettings["weeklyHours"] = {};
  for (const day of Object.keys(own) as (keyof typeof own)[]) {
    const intervals = (own[day] ?? []).flatMap((a) =>
      (limit[day] ?? []).flatMap((b) => {
        const start = a.start > b.start ? a.start : b.start;
        const end = a.end < b.end ? a.end : b.end;
        return start < end ? [{ start, end }] : [];
      })
    );
    if (intervals.length > 0) out[day] = intervals;
  }
  return out;
}

/** Los candidatos de un profesional, ya dentro del horario del negocio. */
export function resourceCandidates(
  settings: CalendarSettings,
  resource: { weeklyHours: CalendarSettings["weeklyHours"] },
  fromISO: string,
  toISO: string
): SlotUtc[] {
  return buildCandidateSlots(
    settings,
    fromISO,
    toISO,
    intersectWeeklyHours(resource.weeklyHours, settings.weeklyHours)
  );
}

/**
 * PURA: 1029 — Los huecos de cada profesional, unidos sin repetir instantes. A
 * cada uno le ocupa lo suyo y lo que no tiene profesional.
 */
export function resourceSlots(
  settings: CalendarSettings,
  resources: AgendaResource[],
  busy: BusyInterval[],
  opts: { fromISO: string; toISO: string; now: Date }
): AvailableSlot[] {
  // Expandir un horario y etiquetar son lo caro (zonas horarias): lo primero se
  // hace una vez por horario distinto, y lo segundo una vez por instante.
  const candidatesOf = new Map<string, SlotUtc[]>();
  const byInstant = new Map<string, SlotUtc & { resourceIds: string[] }>();
  for (const resource of resources) {
    const key = JSON.stringify(resource.weeklyHours);
    let candidates = candidatesOf.get(key);
    if (!candidates) {
      candidates = resourceCandidates(settings, resource, opts.fromISO, opts.toISO);
      candidatesOf.set(key, candidates);
    }
    const free = freeCandidates(
      candidates,
      busy.filter((b) => b.resourceId === null || b.resourceId === resource.id),
      { now: opts.now, minNoticeHours: settings.minNoticeHours }
    );
    for (const slot of free) {
      const seen = byInstant.get(slot.startUtc);
      if (seen) seen.resourceIds.push(resource.id);
      else byInstant.set(slot.startUtc, { ...slot, resourceIds: [resource.id] });
    }
  }
  return [...byInstant.values()]
    .sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc))
    .map((s) => ({ ...s, label: labelInTz(s.startUtc, settings.timezone) }));
}

export async function computeAvailability(
  organizationId: string,
  opts?: {
    fromISO?: string;
    toISO?: string;
    excludeBookingId?: string;
    now?: Date;
    settings?: CalendarSettings;
    /** 1029 — Solo los huecos de este profesional. */
    resourceId?: string | null;
    /** Dentro de una transacción con candado, las lecturas van por ella. */
    reader?: Reader;
  }
): Promise<AvailableSlot[]> {
  const settings = opts?.settings ?? (await getSettings(organizationId));
  const now = opts?.now ?? new Date();
  const tz = settings.timezone;

  const from = opts?.fromISO ?? todayInTz(now, tz);
  const to = opts?.toISO ?? addDaysISO(from, settings.maxDaysAhead);

  const reader = opts?.reader ?? getDb();
  const resources = await listActiveResources(organizationId, reader);
  const busy = await getBusyIntervals(
    organizationId,
    {
      fromUtc: zonedWallClockToUtc(from, "00:00", tz) ?? new Date(0),
      toUtc:
        zonedWallClockToUtc(addDaysISO(to, 1), "00:00", tz) ??
        new Date(now.getTime() + 86_400_000 * 61),
      excludeBookingId: opts?.excludeBookingId,
    },
    reader
  );

  if (resources.length > 0) {
    const targets = opts?.resourceId
      ? resources.filter((r) => r.id === opts.resourceId)
      : resources;
    return resourceSlots(settings, targets, busy, { fromISO: from, toISO: to, now });
  }

  // Sin profesionales, la agenda es la del negocio: todo lo activo ocupa.
  const candidates = buildCandidateSlots(settings, from, to);
  if (candidates.length === 0) return [];
  return filterFreeSlots(candidates, busy, {
    now,
    minNoticeHours: settings.minNoticeHours,
    timezone: tz,
  }).map((s) => ({ ...s, resourceIds: [] }));
}

/**
 * Re-valida que un instante concreto siga libre. Se llama AL CONFIRMAR, nunca
 * al ofrecer. `excludeBookingId` permite reprogramar sin que la propia cita se
 * bloquee a sí misma.
 *
 * Solo recalcula ±1 día alrededor del instante pedido.
 *
 * OJO: esto reduce la ventana de la carrera, no la cierra — entre este SELECT
 * y el INSERT cabe otra confirmación. Quien cierra de verdad es el índice
 * único parcial de `booking` (research D7); esto existe para dar una respuesta
 * útil (con alternativas) en el caso normal.
 */
export async function findSlot(
  organizationId: string,
  whenISO: string,
  opts?: {
    excludeBookingId?: string;
    now?: Date;
    settings?: CalendarSettings;
    resourceId?: string | null;
    reader?: Reader;
  }
): Promise<AvailableSlot | null> {
  const target = Date.parse(whenISO);
  if (Number.isNaN(target)) return null;

  const settings = opts?.settings ?? (await getSettings(organizationId));
  const dayInTz = todayInTz(new Date(target), settings.timezone);

  const slots = await computeAvailability(organizationId, {
    fromISO: addDaysISO(dayInTz, -1),
    toISO: addDaysISO(dayInTz, 1),
    excludeBookingId: opts?.excludeBookingId,
    now: opts?.now,
    settings,
    resourceId: opts?.resourceId,
    reader: opts?.reader,
  });
  return slots.find((s) => Date.parse(s.startUtc) === target) ?? null;
}

async function getBusyIntervals(
  organizationId: string,
  input: { fromUtc: Date; toUtc: Date; excludeBookingId?: string },
  reader: Reader
): Promise<BusyInterval[]> {
  const rows = await reader
    .select({
      id: schema.booking.id,
      resourceId: schema.booking.resourceId,
      scheduledAt: schema.booking.scheduledAt,
      durationMinutes: schema.booking.durationMinutes,
    })
    .from(schema.booking)
    .where(
      scoped(
        schema.booking.organizationId,
        organizationId,
        and(
          // Canceladas y no-show liberan el hueco.
          inArray(schema.booking.status, ["agendada", "realizada"]),
          // Sandbox: una cita de prueba no consume la agenda real.
          eq(schema.booking.isTest, false),
          gte(schema.booking.scheduledAt, input.fromUtc),
          lte(schema.booking.scheduledAt, input.toUtc)
        )
      )
    );

  return rows
    .filter((r) => r.id !== input.excludeBookingId)
    .map((r) => ({
      resourceId: r.resourceId,
      startUtc: r.scheduledAt.toISOString(),
      endUtc: new Date(
        r.scheduledAt.getTime() + r.durationMinutes * 60_000
      ).toISOString(),
    }));
}
