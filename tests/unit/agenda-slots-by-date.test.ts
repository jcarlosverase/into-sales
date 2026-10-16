import { describe, expect, it } from "vitest";
import {
  buildCandidateSlots,
  filterFreeSlots,
  type AvailableSlot,
} from "@/server/agenda/availability";
import {
  DEFAULT_CALENDAR_SETTINGS,
  type CalendarSettings,
} from "@/server/agenda/settings";
import {
  throughoutTheDay,
  buildSlots,
  SLOTS_BY_DATE,
  spreadByDay,
} from "@/server/agenda/spread";
import type { SlotUtc } from "@/lib/time/slots";

/**
 * Huecos por fecha, repartidos a lo largo del día, y hasta dónde llega lo
 * consultado.
 *
 * Fija el fallo de la prueba de punta a punta raíz + Nea: a «¿tienen algo
 * mañana en la tarde?» el agente ofreció 10:00, 10:30 y 11:00 y dijo que el
 * martes solo había mañana, con la agenda libre de 12:00 a 18:30. El CRM
 * ignoraba `date` y solo devolvía las tres primeras horas de cada día.
 */

const LIMA = "America/Lima";
const NY = "America/New_York";
// Lunes 21 sep 2026, 09:00 en Lima (UTC-5 todo el año).
const NOW = new Date("2026-09-21T14:00:00.000Z");

const MON_TO_FRI: CalendarSettings["weeklyHours"] = {
  mon: [{ start: "10:00", end: "19:00" }],
  tue: [{ start: "10:00", end: "19:00" }],
  wed: [{ start: "10:00", end: "19:00" }],
  thu: [{ start: "10:00", end: "19:00" }],
  fri: [{ start: "10:00", end: "19:00" }],
};

function settings(over: Partial<CalendarSettings> = {}): CalendarSettings {
  return {
    ...DEFAULT_CALENDAR_SETTINGS,
    weeklyHours: MON_TO_FRI,
    minNoticeHours: 0,
    maxDaysAhead: 7,
    timezone: LIMA,
    ...over,
  };
}

/** Lo que devolvería el motor para [from, to] con `busy` ocupado. */
function free(
  s: CalendarSettings,
  from: string,
  to: string,
  now: Date = NOW,
  busy: SlotUtc[] = []
): AvailableSlot[] {
  return filterFreeSlots(buildCandidateSlots(s, from, to), busy, {
    now,
    minNoticeHours: s.minNoticeHours,
    timezone: s.timezone,
  });
}

/** Una consulta por fecha, armada como la arma la ruta. */
function byDate(
  s: CalendarSettings,
  date: string,
  now: Date = NOW,
  busy: SlotUtc[] = []
) {
  return buildSlots({
    todos: free(s, date, date, now, busy),
    timezone: s.timezone,
    now,
    maxDaysAhead: s.maxDaysAhead,
    limit: 12,
    perDay: 3,
    days: 5,
    date,
    candidatosDelDia: buildCandidateSlots(s, date, date).length,
  });
}

const hours = (slots: { time: string }[]) => slots.map((s) => s.time);

describe("«¿mañana en la tarde?» (el fallo de la prueba de punta a punta)", () => {
  const s = settings();

  it("el reparto de siempre solo ve la mañana de cada día… y ahora lo dice", () => {
    const { slots, query } = buildSlots({
      todos: free(s, "2026-09-21", "2026-09-28"),
      timezone: LIMA,
      now: NOW,
      maxDaysAhead: 7,
      limit: 12,
      perDay: 3,
      days: 5,
    });
    const tomorrow = slots.filter((x) => x.dayIso === "2026-09-22");
    expect(hours(tomorrow)).toEqual(["10:00", "10:30", "11:00"]);
    // 3 por día × 4 días = 12: el jueves 24 fue el último revisado.
    expect(query).toEqual({
      date: null,
      status: null,
      coveredUntil: "2026-09-24",
      horizonEnd: "2026-09-28",
      perDay: 3,
    });
  });

  it("con date trae TODO el martes, tarde incluida", () => {
    const { slots, query } = byDate(s, "2026-09-22");
    expect(slots).toHaveLength(18); // 10:00 … 18:30, cada 30 min
    expect(hours(slots)).toEqual(
      expect.arrayContaining(["12:00", "15:00", "18:30"])
    );
    expect(slots.every((x) => x.dayIso === "2026-09-22")).toBe(true);
    expect(slots[0]!.dayLabel).toMatch(/^mañana martes/);
    expect(query).toEqual({
      date: "2026-09-22",
      status: "available",
      coveredUntil: "2026-09-22",
      horizonEnd: "2026-09-28",
      perDay: null,
    });
  });

  it("con date, limit/perDay/days no recortan el día", () => {
    const { slots } = buildSlots({
      todos: free(s, "2026-09-25", "2026-09-25"),
      timezone: LIMA,
      now: NOW,
      maxDaysAhead: 7,
      limit: 1,
      perDay: 1,
      days: 1, // el viernes 25 queda FUERA de una ventana de 1 día: no importa
      date: "2026-09-25",
      candidatosDelDia: 18,
    });
    expect(slots).toHaveLength(18);
  });

  it("no mezcla otros días aunque vengan en la lista", () => {
    const { slots } = buildSlots({
      todos: free(s, "2026-09-21", "2026-09-28"),
      timezone: LIMA,
      now: NOW,
      maxDaysAhead: 7,
      limit: 12,
      perDay: 3,
      date: "2026-09-23",
      candidatosDelDia: 18,
    });
    expect(slots).toHaveLength(18);
    expect(slots.every((x) => x.dayIso === "2026-09-23")).toBe(true);
  });
});

describe("repartidos a lo largo del día cuando no caben", () => {
  it("por debajo del tope, la lista tal cual", () => {
    const list = [1, 2, 3];
    expect(throughoutTheDay(list, 24)).toBe(list);
  });

  it("por encima, del primero al último, sin repetir", () => {
    const list = Array.from({ length: 40 }, (_, i) => i);
    const chosen = throughoutTheDay(list, 24);
    expect(chosen).toHaveLength(24);
    expect(chosen[0]).toBe(0);
    expect(chosen[23]).toBe(39);
    for (let i = 1; i < chosen.length; i++) {
      expect(chosen[i]!).toBeGreaterThan(chosen[i - 1]!);
    }
  });

  it("topes degenerados no revientan", () => {
    expect(throughoutTheDay([1, 2, 3], 1)).toEqual([1]);
    expect(throughoutTheDay([1, 2, 3], 0)).toEqual([]);
  });

  it("un día de 48 turnos no se queda en la mañana", () => {
    const s = settings({
      slotMinutes: 15,
      weeklyHours: { tue: [{ start: "08:00", end: "20:00" }] },
    });
    const { slots, query } = byDate(s, "2026-09-22");
    expect(query.status).toBe("available");
    expect(slots).toHaveLength(SLOTS_BY_DATE);
    expect(slots[0]!.time).toBe("08:00");
    expect(slots[slots.length - 1]!.time).toBe("19:45");
    expect(hours(slots).filter((h) => h >= "12:00").length).toBeGreaterThan(10);
  });
});

describe("por qué un día no tiene horas", () => {
  const s = settings();

  it("cerrado: ese día el negocio no abre", () => {
    const { slots, query } = byDate(s, "2026-09-26"); // sábado
    expect(slots).toEqual([]);
    expect(query).toMatchObject({ status: "closed", coveredUntil: "2026-09-26" });
  });

  it("lleno: abre, pero ya no queda nada libre", () => {
    const wholeDay = { startUtc: "2026-09-22T15:00:00.000Z", endUtc: "2026-09-23T00:00:00.000Z" };
    const { slots, query } = byDate(s, "2026-09-22", NOW, [wholeDay]);
    expect(slots).toEqual([]);
    expect(query.status).toBe("full");
  });

  it("lleno también cuando hoy ya cerró", () => {
    const late = new Date("2026-09-22T00:30:00.000Z"); // lun 21, 19:30 Lima
    expect(byDate(s, "2026-09-21", late).query.status).toBe("full");
  });

  it("un día que ya pasó se dice como tal", () => {
    expect(byDate(s, "2026-09-20").query).toMatchObject({
      status: "past",
      coveredUntil: null,
    });
  });

  it("más allá del horizonte no es «lleno»: aún no se abre agenda", () => {
    const { slots, query } = byDate(s, "2026-09-29"); // hoy + 8
    expect(slots).toEqual([]);
    expect(query).toMatchObject({
      status: "beyond_horizon",
      horizonEnd: "2026-09-28",
      coveredUntil: null,
    });
    // El último día del horizonte todavía se agenda.
    expect(byDate(s, "2026-09-28").query.status).toBe("available");
  });
});

describe("la fecha es la del negocio, no la del servidor", () => {
  const s = settings();
  // Lunes 21, 22:30 en Lima; en UTC ya es martes 22.
  const night = new Date("2026-09-22T03:30:00.000Z");

  function queries() {
    const today = byDate(s, "2026-09-21", night);
    const tomorrow = byDate(s, "2026-09-22", night);
    return {
      today: today.query.status,
      tomorrow: tomorrow.query.status,
      hours: hours(tomorrow.slots),
      day: tomorrow.slots[0]?.dayLabel,
      first: tomorrow.slots[0]?.startUtc,
      horizon: tomorrow.query.horizonEnd,
    };
  }

  it("«hoy» se decide en la zona del negocio", () => {
    const r = queries();
    expect(r.today).toBe("full"); // el lunes sigue siendo hoy: no «past»
    expect(r.tomorrow).toBe("available");
    expect(r.day).toMatch(/^mañana martes/);
    expect(r.first).toBe("2026-09-22T15:00:00.000Z"); // 10:00 Lima
    expect(r.horizon).toBe("2026-09-28");
  });

  it("da lo mismo con el proceso en otra zona horaria", () => {
    const expected = queries();
    const original = process.env.TZ;
    try {
      const offsets = {
        "Pacific/Kiritimati": -840, // UTC+14: ya es otro día casi siempre
        "Pacific/Pago_Pago": 660, // UTC-11
        "Asia/Tokyo": -540,
      };
      for (const [tz, offset] of Object.entries(offsets)) {
        process.env.TZ = tz;
        // Que el cambio de zona sí surtió efecto en este proceso.
        expect(new Date("2026-01-01T00:00:00Z").getTimezoneOffset()).toBe(offset);
        expect(queries()).toEqual(expected);
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});

describe("horario de verano en la zona del negocio", () => {
  const daily = { start: "09:00", end: "18:00" };
  const s = settings({
    timezone: NY,
    weeklyHours: {
      mon: [daily], tue: [daily], wed: [daily], thu: [daily],
      fri: [daily], sat: [daily], sun: [daily],
    },
  });

  it("el día que se adelanta el reloj: 09:00 es 13:00Z, y son las 18 horas", () => {
    const now = new Date("2026-03-07T12:00:00.000Z");
    const before = byDate(s, "2026-03-07", now);
    const change = byDate(s, "2026-03-08", now);
    expect(before.slots[0]!.startUtc).toBe("2026-03-07T14:00:00.000Z"); // EST
    expect(change.slots[0]!.startUtc).toBe("2026-03-08T13:00:00.000Z"); // EDT
    expect(change.slots).toHaveLength(18);
    expect(change.slots[17]!.time).toBe("17:30");
    expect(change.slots.every((x) => x.dayIso === "2026-03-08")).toBe(true);
  });

  it("el día que se atrasa el reloj: 09:00 es 14:00Z", () => {
    const now = new Date("2026-10-31T12:00:00.000Z");
    const change = byDate(s, "2026-11-01", now);
    expect(change.slots[0]!.startUtc).toBe("2026-11-01T14:00:00.000Z"); // EST
    expect(change.slots).toHaveLength(18);
    expect(new Set(hours(change.slots)).size).toBe(18);
  });

  it("un hueco de noche cae en su día local aunque en UTC ya sea el siguiente", () => {
    const night = settings({
      timezone: NY,
      weeklyHours: { sun: [{ start: "20:00", end: "23:30" }] },
    });
    const now = new Date("2026-03-07T12:00:00.000Z");
    const { slots, query } = byDate(night, "2026-03-08", now);
    expect(query.status).toBe("available");
    expect(hours(slots)).toEqual(["20:00", "20:30", "21:00", "21:30", "22:00", "22:30", "23:00"]);
    expect(slots[slots.length - 1]!.startUtc).toBe("2026-03-09T03:00:00.000Z");
    expect(slots.every((x) => x.dayIso === "2026-03-08")).toBe(true);
  });
});

describe("sin date: el reparto de siempre, con cobertura", () => {
  const s = settings({ maxDaysAhead: 14 });
  const everyone = free(s, "2026-09-21", "2026-10-05");

  /** La ruta ANTES de R10: repartir y luego recortar a `days`. */
  function before(limit: number, perDay: number, days: number): string[] {
    const today = Date.parse("2026-09-21T00:00:00Z");
    return spreadByDay(everyone, { timezone: LIMA, limit, perDay, now: NOW })
      .filter((x) => {
        const diff = (Date.parse(`${x.dayIso}T00:00:00Z`) - today) / 86_400_000;
        return diff >= 0 && diff < days;
      })
      .map((x) => x.startUtc);
  }

  it.each([
    [12, 3, 5],
    [4, 3, 5],
    [48, 8, 14],
    [12, 3, 1],
    [12, 1, 2],
    [5, 2, 3],
  ])("limit=%i perDay=%i days=%i da los mismos huecos que antes", (limit, perDay, days) => {
    const { slots } = buildSlots({
      todos: everyone,
      timezone: LIMA,
      now: NOW,
      maxDaysAhead: 14,
      limit,
      perDay,
      days,
    });
    expect(slots.map((x) => x.startUtc)).toEqual(before(limit, perDay, days));
  });

  it("si no se llenó, se revisó toda la ventana", () => {
    // 2 días hábiles × 3 = 6 < 12: lo que falta en la ventana SÍ está cerrado.
    const { slots, query } = buildSlots({
      todos: everyone,
      timezone: LIMA,
      now: NOW,
      maxDaysAhead: 14,
      limit: 12,
      perDay: 3,
      days: 2,
    });
    expect(slots).toHaveLength(6);
    expect(query.coveredUntil).toBe("2026-09-22");
  });

  it("una ventana más larga que el horizonte se queda en el horizonte", () => {
    const { query } = buildSlots({
      todos: free(settings(), "2026-09-21", "2026-09-28"),
      timezone: LIMA,
      now: NOW,
      maxDaysAhead: 7,
      limit: 48,
      perDay: 8,
      days: 14,
    });
    expect(query.coveredUntil).toBe("2026-09-28");
    expect(query.horizonEnd).toBe("2026-09-28");
  });

  it("sin huecos no inventa días y dice que revisó todo", () => {
    const { slots, query } = buildSlots({
      todos: [],
      timezone: LIMA,
      now: NOW,
      maxDaysAhead: 7,
      limit: 12,
      perDay: 3,
      days: 5,
    });
    expect(slots).toEqual([]);
    expect(query.coveredUntil).toBe("2026-09-25");
  });
});
