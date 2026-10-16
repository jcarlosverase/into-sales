import { describe, expect, it } from "vitest";
import { attentionHoursSchema, DEFAULT_ATTENTION_HOURS, isWithinAttentionHours } from "@/lib/attention";

// 2026-10-15 es jueves.
const lima = (iso: string) => new Date(`${iso}-05:00`);

describe("031 — horario de atención", () => {
  it("dentro y fuera, con el inicio adentro y el fin afuera", () => {
    const h = DEFAULT_ATTENTION_HOURS;
    expect(isWithinAttentionHours(lima("2026-10-15T09:00"), h, "America/Lima")).toBe(true);
    expect(isWithinAttentionHours(lima("2026-10-15T17:59"), h, "America/Lima")).toBe(true);
    expect(isWithinAttentionHours(lima("2026-10-15T18:00"), h, "America/Lima")).toBe(false);
    expect(isWithinAttentionHours(lima("2026-10-15T08:59"), h, "America/Lima")).toBe(false);
    expect(isWithinAttentionHours(lima("2026-10-17T11:00"), h, "America/Lima")).toBe(false); // sábado
  });

  it("usa la zona del horario, no la del servidor", () => {
    // 23:30 en Lima del jueves es viernes 04:30 en UTC.
    const now = lima("2026-10-15T23:30");
    const nightShift = { thu: [{ start: "22:00", end: "24:00" }] };
    expect(isWithinAttentionHours(now, nightShift, "America/Lima")).toBe(true);
    expect(isWithinAttentionHours(now, nightShift, "UTC")).toBe(false);
  });

  it("varios tramos en un día y días sin horario", () => {
    const split = { thu: [{ start: "09:00", end: "13:00" }, { start: "15:00", end: "19:00" }] };
    expect(isWithinAttentionHours(lima("2026-10-15T14:00"), split, "America/Lima")).toBe(false);
    expect(isWithinAttentionHours(lima("2026-10-15T16:00"), split, "America/Lima")).toBe(true);
    expect(isWithinAttentionHours(lima("2026-10-15T10:00"), {}, "America/Lima")).toBe(false);
  });

  it("valida días, HH:MM e inicio antes que fin (AC1)", () => {
    expect(attentionHoursSchema.safeParse({ mon: [{ start: "09:00", end: "18:00" }], sat: [] }).success).toBe(true);
    expect(attentionHoursSchema.safeParse({ mon: [{ start: "18:00", end: "09:00" }] }).success).toBe(false);
    expect(attentionHoursSchema.safeParse({ mon: [{ start: "9:00", end: "18:00" }] }).success).toBe(false);
    expect(attentionHoursSchema.safeParse({ lunes: [] }).success).toBe(false);
    expect(attentionHoursSchema.safeParse({ fri: [{ start: "22:00", end: "24:00" }] }).success).toBe(true);
  });
});
