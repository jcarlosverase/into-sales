import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL, useTestDatabase } from "./test-db";

/** 031 — La puerta del horario de atención con el perfil y la zona de la base. */
describe.skipIf(!TEST_DATABASE_URL)("031 — attention hours gate", () => {
  let drop: () => Promise<void>;
  const org = "org_attention";
  // Jueves 15 de octubre de 2026, 10:00 y 20:00 en Lima.
  const morning = new Date("2026-10-15T15:00:00Z");
  const night = new Date("2026-10-16T01:00:00Z");

  beforeAll(async () => {
    ({ drop } = await useTestDatabase());
    const { getDb, schema } = await import("@/lib/db");
    const db = getDb();
    await db.insert(schema.organization).values({ id: org, name: "Academia Horario" });
    // La zona del negocio sale de la agenda: Lima.
    await db.insert(schema.calendarSettings).values({ id: "cal_att", organizationId: org, weeklyHours: {}, timezone: "America/Lima" });
    await db.insert(schema.agentProfile).values({ id: "ap_att", organizationId: org, enabled: true });
  });

  afterAll(async () => {
    await drop?.();
  });

  const profile = async () => {
    const { getDb, schema } = await import("@/lib/db");
    const [p] = await getDb().select().from(schema.agentProfile);
    return p!;
  };
  const set = async (values: Record<string, unknown>) => {
    const { getDb, schema } = await import("@/lib/db");
    await getDb().update(schema.agentProfile).set(values);
  };

  it("never silences with the default mode (AC3)", async () => {
    const { silencedByAttentionHours } = await import("@/server/ai/attention");
    expect((await profile()).replyMode).toBe("always");
    expect(await silencedByAttentionHours(org, await profile(), morning)).toBe(false);
  });

  it("silences inside the default hours in the business zone, not outside (AC2, D2)", async () => {
    const { silencedByAttentionHours, resolveAttention } = await import("@/server/ai/attention");
    await set({ replyMode: "outside_hours" });
    expect(await resolveAttention(org, await profile())).toMatchObject({ timezone: "America/Lima" });
    expect(await silencedByAttentionHours(org, await profile(), morning)).toBe(true);
    expect(await silencedByAttentionHours(org, await profile(), night)).toBe(false);
  });

  it("uses the saved hours and zone, and falls back on bad data", async () => {
    const { silencedByAttentionHours } = await import("@/server/ai/attention");
    await set({ attentionHours: { thu: [{ start: "19:00", end: "22:00" }] }, attentionTimezone: "America/Lima" });
    expect(await silencedByAttentionHours(org, await profile(), night)).toBe(true);
    expect(await silencedByAttentionHours(org, await profile(), morning)).toBe(false);
    await set({ attentionHours: { thu: "basura" }, attentionTimezone: "Marte/Olympus" });
    // Horario por defecto (L–V 09–18) en la zona del negocio.
    expect(await silencedByAttentionHours(org, await profile(), morning)).toBe(true);
  });
});
