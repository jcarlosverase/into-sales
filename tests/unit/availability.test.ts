import { describe, expect, it } from "vitest";
import {
  buildCandidateSlots,
  filterFreeSlots,
} from "@/server/agenda/availability";
import {
  DEFAULT_CALENDAR_SETTINGS,
  normalizeWeeklyHours,
  type CalendarSettings,
} from "@/server/agenda/settings";
import { daysWithAgenda, spreadByDay } from "@/server/agenda/spread";

/** 015 — El motor: horario − ocupado, con aviso mínimo. Sin BD ni reloj real. */

const PE = "America/Lima";

function settings(over: Partial<CalendarSettings> = {}): CalendarSettings {
  // Estas pruebas razonan en hora de Perú: la zona va explícita, no por defecto.
  return { ...DEFAULT_CALENDAR_SETTINGS, timezone: PE, ...over };
}

describe("buildCandidateSlots", () => {
  it("solo genera slots en los días con horario (L-V por defecto)", () => {
    // 2026-08-08 es sábado; 2026-08-10 lunes.
    const slots = buildCandidateSlots(settings(), "2026-08-08", "2026-08-10");
    const days = new Set(slots.map((s) => s.startUtc.slice(0, 10)));
    expect(days.has("2026-08-08")).toBe(false); // sábado cerrado
    expect(days.has("2026-08-09")).toBe(false); // domingo cerrado
    expect(days.size).toBeGreaterThan(0); // el lunes sí
  });

  it("respeta la duración configurada", () => {
    const short = buildCandidateSlots(
      settings({ slotMinutes: 30 }),
      "2026-08-05",
      "2026-08-05"
    );
    const longOnes = buildCandidateSlots(
      settings({ slotMinutes: 60 }),
      "2026-08-05",
      "2026-08-05"
    );
    // 09:00-18:00 ⇒ 18 slots de 30 min, 9 de 60.
    expect(short).toHaveLength(18);
    expect(longOnes).toHaveLength(9);
  });

  it("un horario vacío no genera nada (negocio sin configurar días)", () => {
    expect(
      buildCandidateSlots(
        settings({ weeklyHours: {} }),
        "2026-08-03",
        "2026-08-07"
      )
    ).toEqual([]);
  });
});

describe("filterFreeSlots", () => {
  const tz = PE;
  const candidates = buildCandidateSlots(
    settings(),
    "2026-08-05",
    "2026-08-05"
  );

  it("descarta lo que no cumple el aviso mínimo", () => {
    // "Ahora" son las 09:00 locales del mismo día, con 2 h de aviso ⇒ el
    // primer hueco ofrecible es a las 11:00 locales (17:00Z).
    const now = new Date("2026-08-05T15:00:00.000Z");
    const free = filterFreeSlots(candidates, [], {
      now,
      minNoticeHours: 2,
      timezone: tz,
    });
    expect(free[0]!.startUtc).toBe("2026-08-05T17:00:00.000Z");
  });

  it("sin aviso mínimo ofrece desde el instante actual", () => {
    const now = new Date("2026-08-05T15:00:00.000Z");
    const free = filterFreeSlots(candidates, [], {
      now,
      minNoticeHours: 0,
      timezone: tz,
    });
    expect(free[0]!.startUtc).toBe("2026-08-05T15:00:00.000Z");
  });

  it("una cita ocupada retira su hueco y solo ese", () => {
    const now = new Date("2026-08-05T00:00:00.000Z");
    const busy = [
      {
        startUtc: "2026-08-05T16:00:00.000Z",
        endUtc: "2026-08-05T16:30:00.000Z",
      },
    ];
    const freeValue = filterFreeSlots(candidates, busy, {
      now,
      minNoticeHours: 0,
      timezone: tz,
    });
    const starts = freeValue.map((s) => s.startUtc);
    expect(starts).not.toContain("2026-08-05T16:00:00.000Z");
    expect(starts).toContain("2026-08-05T16:30:00.000Z");
    expect(starts).toContain("2026-08-05T15:30:00.000Z");
  });

  it("un bloqueo largo retira todos los huecos que toca", () => {
    const now = new Date("2026-08-05T00:00:00.000Z");
    const block = [
      {
        startUtc: "2026-08-05T15:00:00.000Z",
        endUtc: "2026-08-05T17:00:00.000Z", // 2 h ⇒ 4 slots de 30
      },
    ];
    const freeValue = filterFreeSlots(candidates, block, {
      now,
      minNoticeHours: 0,
      timezone: tz,
    });
    expect(freeValue).toHaveLength(candidates.length - 4);
  });

  it("devuelve los huecos ordenados y etiquetados", () => {
    const now = new Date("2026-08-05T00:00:00.000Z");
    const freeValue = filterFreeSlots([...candidates].reverse(), [], {
      now,
      minNoticeHours: 0,
      timezone: tz,
    });
    const times = freeValue.map((s) => Date.parse(s.startUtc));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(freeValue[0]!.label).toContain("09:00");
  });

  it("agenda llena ⇒ lista vacía, no error", () => {
    const now = new Date("2026-08-05T00:00:00.000Z");
    const everything = candidates.map((c) => ({
      startUtc: c.startUtc,
      endUtc: c.endUtc,
    }));
    expect(
      filterFreeSlots(candidates, everything, {
        now,
        minNoticeHours: 0,
        timezone: tz,
      })
    ).toEqual([]);
  });
});

/**
 * Sin reparto, los primeros huecos se los come el día de hoy y quien ofrece se
 * queda sin nada que decir cuando el lead pide otro día.
 */
describe("spreadByDay", () => {
  // 14:00Z son las 08:00 en México: "hoy" es el miércoles 5, no la víspera.
  // (Con 00:00Z el día local del negocio sería todavía el 4 — el motor decide
  // el día en la zona del negocio, no en la del servidor.)
  const now = new Date("2026-08-05T14:00:00.000Z");
  // Mié 5 a vie 7 de agosto, 09:00-18:00, citas de 30 ⇒ 18 huecos por día.
  const freeValue = filterFreeSlots(
    buildCandidateSlots(settings(), "2026-08-05", "2026-08-07"),
    [],
    { now, minNoticeHours: 0, timezone: PE }
  );

  it("toma como mucho `perDay` de cada día, en vez de los N más próximos", () => {
    const spread = spreadByDay(freeValue, {
      timezone: PE,
      limit: 12,
      perDay: 3,
      now,
    });
    expect(spread).toHaveLength(9); // 3 días × 3
    expect(daysWithAgenda(spread)).toEqual([
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
    ]);
  });

  it("el límite corta el total sin romper el reparto", () => {
    const spread = spreadByDay(freeValue, {
      timezone: PE,
      limit: 4,
      perDay: 3,
      now,
    });
    expect(spread).toHaveLength(4);
    // 3 del primer día + 1 del segundo: el límite no se come la variedad.
    expect(daysWithAgenda(spread)).toEqual(["2026-08-05", "2026-08-06"]);
  });

  it("cada hueco viaja con su día EN PALABRAS y su hora", () => {
    const spread = spreadByDay(freeValue, {
      timezone: PE,
      limit: 3,
      perDay: 1,
      now,
    });
    expect(spread[0]!.dayLabel).toMatch(/^hoy /);
    expect(spread[1]!.dayLabel).toMatch(/^mañana /);
    expect(spread[0]!.time).toBe("09:00");
  });

  it("sin huecos no inventa días", () => {
    expect(
      spreadByDay([], { timezone: PE, limit: 12, perDay: 3, now })
    ).toEqual([]);
  });
});

describe("normalizeWeeklyHours", () => {
  it("descarta intervalos inválidos sin tumbar el resto del horario", () => {
    const out = normalizeWeeklyHours({
      mon: [
        { start: "09:00", end: "18:00" },
        { start: "20:00", end: "19:00" }, // fin antes del inicio
        { start: "9:00", end: "18:00" }, // formato inválido
      ],
      tue: [],
    });
    expect(out.mon).toEqual([{ start: "09:00", end: "18:00" }]);
    expect(out.tue).toBeUndefined(); // día sin franjas válidas = cerrado
  });

  it("ordena las franjas por hora de inicio", () => {
    const out = normalizeWeeklyHours({
      wed: [
        { start: "16:00", end: "18:00" },
        { start: "09:00", end: "13:00" },
      ],
    });
    expect(out.wed?.[0]?.start).toBe("09:00");
  });
});
