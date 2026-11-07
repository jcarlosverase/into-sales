import { describe, expect, it } from "vitest";
import {
  joinNames,
  offerMatches,
  pickResource,
  resourceQuestion,
} from "@/lib/agenda-resources";
import { intersectWeeklyHours, resourceSlots } from "@/server/agenda/availability";
import { DEFAULT_CALENDAR_SETTINGS } from "@/server/agenda/settings";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";
import type { AgendaResource } from "@/server/agenda/resources";

/** 1029 — Las reglas puras de los profesionales o recursos. */

const settings = {
  ...DEFAULT_CALENDAR_SETTINGS,
  slotMinutes: 60,
  minNoticeHours: 0,
  timezone: "America/Lima",
};
const person = (id: string, weeklyHours: AgendaResource["weeklyHours"], position = 0): AgendaResource => ({
  id,
  kind: "person",
  name: id,
  weeklyHours,
  position,
  active: true,
});
const MONDAY = "2026-11-09";
const NOW = new Date("2026-11-09T05:00:00Z");
const at = (hour: number) => `2026-11-09T${String(hour + 5).padStart(2, "0")}:00:00.000Z`;
const morning = { mon: [{ start: "09:00", end: "11:00" }] };
const lateMorning = { mon: [{ start: "10:00", end: "12:00" }] };
const range = { fromISO: MONDAY, toISO: MONDAY, now: NOW };

describe("pickResource", () => {
  const list = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("takes someone free at random", () => {
    expect(pickResource(["c", "b"], list, () => 0)?.id).toBe("b");
    expect(pickResource(["c", "b"], list, () => 0.99)?.id).toBe("c");
  });

  it("over many draws, everyone free gets picked", () => {
    const picked = new Set(Array.from({ length: 200 }, () => pickResource(["a", "b", "c"], list)?.id));
    expect(picked).toEqual(new Set(["a", "b", "c"]));
  });

  it("never picks someone who is busy", () => {
    expect(pickResource(["b"], list, () => 0.99)?.id).toBe("b");
  });

  it("is null when nobody is free", () => {
    expect(pickResource([], list)).toBeNull();
  });
});

describe("offerMatches", () => {
  it("an offer with someone only accepts that person", () => {
    expect(offerMatches("a", "a")).toBe(true);
    expect(offerMatches("a", "b")).toBe(false);
    expect(offerMatches("a", null)).toBe(true);
  });

  it("an offer with anyone accepts whoever is asked for", () => {
    expect(offerMatches(null, "b")).toBe(true);
    expect(offerMatches(undefined, undefined)).toBe(true);
  });
});

describe("intersectWeeklyHours", () => {
  it("keeps what both have, split by the business intervals", () => {
    const own = { mon: [{ start: "08:00", end: "19:00" }], sun: [{ start: "09:00", end: "12:00" }] };
    const business = {
      mon: [
        { start: "09:00", end: "13:00" },
        { start: "15:00", end: "18:00" },
      ],
    };
    expect(intersectWeeklyHours(own, business)).toEqual({
      mon: [
        { start: "09:00", end: "13:00" },
        { start: "15:00", end: "18:00" },
      ],
    });
  });

  it("drops an interval that only touches the limit", () => {
    const own = { mon: [{ start: "18:00", end: "20:00" }] };
    expect(intersectWeeklyHours(own, { mon: [{ start: "09:00", end: "18:00" }] })).toEqual({});
  });
});

describe("the question", () => {
  it("names people and resources in plain Spanish", () => {
    expect(joinNames(["Ana"])).toBe("Ana");
    expect(joinNames(["Ana", "Luis", "Rosa"])).toBe("Ana, Luis o Rosa");
    expect(resourceQuestion([{ name: "Ana", kind: "person" }, { name: "Luis", kind: "person" }])).toBe(
      "¿Con quién prefieres atenderte: Ana o Luis?"
    );
    expect(resourceQuestion([{ name: "Sala 1", kind: "resource" }, { name: "Sala 2", kind: "resource" }])).toBe(
      "¿Cuál prefieres: Sala 1 o Sala 2?"
    );
  });
});

describe("resourceSlots", () => {
  it("follows each person's own hours and never repeats an instant", () => {
    const slots = resourceSlots(settings, [person("a", morning), person("b", lateMorning, 1)], [], range);
    expect(slots.map((s) => [s.startUtc, s.resourceIds])).toEqual([
      [at(9), ["a"]],
      [at(10), ["a", "b"]],
      [at(11), ["b"]],
    ]);
  });

  it("a person's booking only takes that person", () => {
    const busy = [{ resourceId: "a", startUtc: at(10), endUtc: at(11) }];
    const slots = resourceSlots(settings, [person("a", morning), person("b", morning, 1)], busy, range);
    expect(slots.find((s) => s.startUtc === at(10))?.resourceIds).toEqual(["b"]);
  });

  it("what has no professional takes everyone", () => {
    const busy = [{ resourceId: null, startUtc: at(9), endUtc: at(10) }];
    const slots = resourceSlots(settings, [person("a", morning), person("b", morning, 1)], busy, range);
    expect(slots.some((s) => s.startUtc === at(9))).toBe(false);
  });

  it("a person cannot work a day the business has closed (AC3)", () => {
    const sunday = { sun: [{ start: "09:00", end: "10:00" }] };
    const slots = resourceSlots(settings, [person("a", sunday)], [], {
      fromISO: "2026-11-15",
      toISO: "2026-11-15",
      now: NOW,
    });
    expect(slots).toHaveLength(0);
  });

  it("a person's hours are cut at the business hours (AC3)", () => {
    const long = { mon: [{ start: "07:00", end: "10:00" }] };
    const slots = resourceSlots(settings, [person("a", long)], [], range);
    expect(slots.map((s) => s.startUtc)).toEqual([at(9)]); // el negocio abre a las 09:00
  });
});

describe("the agent prompt", () => {
  const base = { profile: { name: "Lúa" } as never, kb: [], stages: [], agenda: true };

  it("does not mention professionals with fewer than two", () => {
    expect(buildAgentSystemPrompt({ ...base, resources: [{ id: "res_a", name: "Ana" }] })).not.toContain("resourceId");
  });

  it("lists them with two or more, and says how to choose", () => {
    const prompt = buildAgentSystemPrompt({
      ...base,
      resources: [
        { id: "res_a", name: "Ana" },
        { id: "res_b", name: "Luis" },
      ],
    });
    expect(prompt).toContain('Ana (resourceId "res_a")');
    expect(prompt).toContain('"resourceId":"any"');
  });

  it("says nothing with the agenda off", () => {
    expect(
      buildAgentSystemPrompt({ ...base, agenda: false, resources: [{ id: "a", name: "A" }, { id: "b", name: "B" }] })
    ).not.toContain("resourceId");
  });
});
