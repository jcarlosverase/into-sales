import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL, useTestDatabase } from "./test-db";

/** 029 — «A quién llamar hoy» contra PostgreSQL. */
describe.skipIf(!TEST_DATABASE_URL)("029 — today list", () => {
  let drop: () => Promise<void>;
  const org = "org_today";
  const owner = { kind: "all" } as const;
  const ana = { kind: "assigned", userId: "usr_ana" } as const;
  // 03:00 UTC on the 16th is still the 15th in Lima: «hoy» is the business day (D2).
  const now = new Date("2026-10-16T03:00:00Z");

  beforeAll(async () => {
    ({ drop } = await useTestDatabase());
    const { getDb, schema } = await import("@/lib/db");
    const db = getDb();
    await db.insert(schema.organization).values({ id: org, name: "Academia Hoy" });
    await db.insert(schema.user).values([
      { id: "usr_ana", name: "Ana", email: "ana@hoy.test" },
      { id: "usr_beto", name: "Beto", email: "beto@hoy.test" },
    ]);
    await db.insert(schema.calendarSettings).values({
      id: "cal_hoy",
      organizationId: org,
      weeklyHours: {},
      timezone: "America/Lima",
    });
    await db.insert(schema.pipelineStage).values([
      { id: "stg_open", organizationId: org, name: "Interesado", position: 0 },
      { id: "stg_won", organizationId: org, name: "Ganado", position: 1, kind: "won" },
    ]);
    const lead = async (
      key: string,
      opts: { user?: string; followUpOn?: string | null; stage?: string; archived?: boolean; wrote?: boolean; priority?: "alta" | "media" | "baja"; created?: string }
    ) => {
      await db.insert(schema.contact).values({
        id: `ct_${key}`,
        organizationId: org,
        waIdentity: `51900${key}`,
        name: key,
        phone: `51900${key.length}`,
        archivedAt: opts.archived ? new Date("2026-10-01T00:00:00Z") : null,
      });
      await db.insert(schema.lead).values({
        id: `ld_${key}`,
        organizationId: org,
        contactId: `ct_${key}`,
        stageId: opts.stage ?? "stg_open",
        assignedUserId: opts.user ?? "usr_ana",
        followUpOn: opts.followUpOn ?? null,
        priority: opts.priority ?? null,
        createdAt: new Date(opts.created ?? "2026-10-10T12:00:00Z"),
      });
      await db.insert(schema.conversation).values({ id: `cv_${key}`, organizationId: org, contactId: `ct_${key}` });
      await db.insert(schema.message).values({ id: `msg_in_${key}`, organizationId: org, conversationId: `cv_${key}`, direction: "in", text: "hola" });
      if (opts.wrote) {
        await db.insert(schema.message).values({ id: `msg_out_${key}`, organizationId: org, conversationId: `cv_${key}`, direction: "out", text: "¡hola!" });
      }
    };
    await lead("Atrasado", { followUpOn: "2026-10-13" });
    await lead("AtrasadoAyer", { followUpOn: "2026-10-14", priority: "alta" });
    await lead("ParaHoy", { followUpOn: "2026-10-15" });
    await lead("ParaHoyAlta", { followUpOn: "2026-10-15", priority: "alta" });
    await lead("Futuro", { followUpOn: "2026-10-20" });
    await lead("NuevoViejo", { created: "2026-10-01T12:00:00Z" });
    await lead("NuevoReciente", { created: "2026-10-14T12:00:00Z" });
    await lead("YaLeEscribimos", { wrote: true });
    await lead("Ganado", { followUpOn: "2026-10-13", stage: "stg_won" });
    await lead("Archivado", { followUpOn: "2026-10-13", archived: true });
    await lead("DeBeto", { followUpOn: "2026-10-13", user: "usr_beto" });
    await lead("SinAsignar", { followUpOn: "2026-10-15", user: undefined });
    await db.update(schema.lead).set({ assignedUserId: null }).where((await import("drizzle-orm")).eq(schema.lead.id, "ld_SinAsignar"));
  });

  afterAll(async () => {
    await drop?.();
  });

  const names = (list: { sections: { id: string; items: { name: string }[] }[] }, id: string) =>
    list.sections.find((s) => s.id === id)!.items.map((i) => i.name);

  it("uses the business day and the three sections, in order (AC2, D2, D3)", async () => {
    const { todayList } = await import("@/server/leads/today");
    const list = await todayList(org, ana, { kind: "all" }, now);
    expect(list).toMatchObject({ today: "2026-10-15", timezone: "America/Lima" });
    expect(names(list, "overdue")).toEqual(["Atrasado", "AtrasadoAyer"]);
    expect(names(list, "today")).toEqual(["ParaHoyAlta", "ParaHoy"]);
    expect(names(list, "first_contact")).toEqual(["NuevoViejo", "NuevoReciente"]);
    expect(list.sections.map((s) => s.total)).toEqual([2, 2, 2]);
  });

  it("leaves out closed stages, archived contacts and those the business already wrote to (AC3, AC4)", async () => {
    const { todayList } = await import("@/server/leads/today");
    const all = (await todayList(org, owner, { kind: "all" }, now)).sections.flatMap((s) => s.items.map((i) => i.name));
    for (const name of ["Ganado", "Archivado", "YaLeEscribimos", "Futuro"]) expect(all).not.toContain(name);
  });

  it("gives a rep only theirs and lets a supervisor pick (AC5, D4)", async () => {
    const { todayList } = await import("@/server/leads/today");
    const forAna = await todayList(org, ana, { kind: "user", userId: "usr_beto" }, now);
    expect(names(forAna, "overdue")).not.toContain("DeBeto");
    const ownerAll = await todayList(org, owner, { kind: "all" }, now);
    expect(names(ownerAll, "overdue")).toContain("DeBeto");
    expect(names(ownerAll, "today")).toContain("SinAsignar");
    const ownerBeto = await todayList(org, owner, { kind: "user", userId: "usr_beto" }, now);
    expect(ownerBeto.sections.flatMap((s) => s.items.map((i) => i.name))).toEqual(["DeBeto"]);
    const unassigned = await todayList(org, owner, { kind: "unassigned" }, now);
    expect(unassigned.sections.flatMap((s) => s.items.map((i) => i.name))).toEqual(["SinAsignar"]);
  });

  it("brings what each row needs: phone, conversation, stage and assignee", async () => {
    const { todayList } = await import("@/server/leads/today");
    const [first] = (await todayList(org, owner, { kind: "all" }, now)).sections[0]!.items;
    expect(first).toMatchObject({ name: "Atrasado", phone: expect.any(String), conversationId: "cv_Atrasado", stageName: "Interesado", assignee: { id: "usr_ana", name: "Ana" } });
  });
});
