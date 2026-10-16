import { describe, expect, it } from "vitest";
import { addDays, followUpChoices, isIsoDay, overdueLabel, sortSection } from "@/lib/today";

describe("029 — fechas de «Hoy»", () => {
  it("suma días de calendario cruzando mes y año", () => {
    expect(addDays("2026-10-15", 1)).toBe("2026-10-16");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-29", 7)).toBe("2027-01-05");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("solo acepta días reales AAAA-MM-DD", () => {
    expect(isIsoDay("2026-10-15")).toBe(true);
    for (const bad of ["2026-02-30", "2026-13-01", "15/10/2026", "2026-10-15T00:00:00Z", ""]) expect(isIsoDay(bad), bad).toBe(false);
  });

  it("«Hecho» ofrece mañana, 3 días, una semana o sin fecha desde hoy del negocio (D5)", () => {
    expect(followUpChoices("2026-10-15")).toEqual([
      { label: "Mañana", value: "2026-10-16" },
      { label: "En 3 días", value: "2026-10-18" },
      { label: "En una semana", value: "2026-10-22" },
      { label: "Sin fecha", value: null },
    ]);
  });

  it("dice cuánto se atrasó un seguimiento", () => {
    expect(overdueLabel("2026-10-14", "2026-10-15")).toBe("ayer");
    expect(overdueLabel("2026-10-10", "2026-10-15")).toBe("hace 5 días");
    expect(overdueLabel("2026-10-15", "2026-10-15")).toBe("hoy");
  });
});

describe("029 — orden de cada sección (D3)", () => {
  const item = (name: string, priority: "alta" | "media" | "baja" | null, followUpOn: string | null, createdAt = "2026-10-01T00:00:00Z") => ({
    name,
    priority,
    followUpOn,
    createdAt,
  });

  it("vencidos: lo más atrasado primero, luego prioridad", () => {
    const sorted = sortSection("overdue", [
      item("C", "baja", "2026-10-12"),
      item("A", null, "2026-10-10"),
      item("B", "alta", "2026-10-12"),
    ]);
    expect(sorted.map((i) => i.name)).toEqual(["A", "B", "C"]);
  });

  it("para hoy: prioridad alta, media, baja, sin prioridad; luego nombre", () => {
    const sorted = sortSection("today", [item("Zoe", null, "x"), item("Ana", "baja", "x"), item("Beto", "alta", "x"), item("Ciro", "alta", "x")]);
    expect(sorted.map((i) => i.name)).toEqual(["Beto", "Ciro", "Ana", "Zoe"]);
  });

  it("sin primer contacto: lo más antiguo primero", () => {
    const sorted = sortSection("first_contact", [
      item("Nuevo", null, null, "2026-10-14T10:00:00Z"),
      item("Viejo", null, null, "2026-10-01T10:00:00Z"),
    ]);
    expect(sorted.map((i) => i.name)).toEqual(["Viejo", "Nuevo"]);
  });
});
