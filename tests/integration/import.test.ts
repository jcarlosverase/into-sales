import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL, useTestDatabase } from "./test-db";

/** 030 — Importar contactos contra PostgreSQL: contactos, leads, turno y repetir. */
describe.skipIf(!TEST_DATABASE_URL)("030 — import contacts", () => {
  let drop: () => Promise<void>;
  const org = "org_import";
  const csv = (s: string) => new TextEncoder().encode(s);

  beforeAll(async () => {
    ({ drop } = await useTestDatabase());
    const { getDb, schema } = await import("@/lib/db");
    const db = getDb();
    await db.insert(schema.organization).values({ id: org, name: "Academia Import" });
    await db.insert(schema.user).values([
      { id: "usr_owner", name: "Dueña", email: "owner@import.test" },
      { id: "usr_ana", name: "Ana", email: "ana@import.test" },
      { id: "usr_beto", name: "Beto", email: "beto@import.test" },
    ]);
    await db.insert(schema.member).values([
      { id: "mem_o", organizationId: org, userId: "usr_owner", role: "owner", createdAt: new Date("2026-01-01") },
      { id: "mem_a", organizationId: org, userId: "usr_ana", role: "member", createdAt: new Date("2026-01-02") },
      { id: "mem_b", organizationId: org, userId: "usr_beto", role: "member", createdAt: new Date("2026-01-03") },
    ]);
    await db.insert(schema.pipelineStage).values([
      { id: "stg_new", organizationId: org, name: "Nuevo", position: 0 },
      { id: "stg_int", organizationId: org, name: "Interesado", position: 1 },
    ]);
    // Ya existe: la importación no lo toca.
    await db.insert(schema.contact).values({ id: "ct_old", organizationId: org, waIdentity: "51911000000", phone: "51911000000", name: "Antigua", notes: "no tocar" });
  });

  afterAll(async () => {
    await drop?.();
  });

  const leadsOf = async () => {
    const { getDb, schema } = await import("@/lib/db");
    return getDb()
      .select({ name: schema.contact.name, stageId: schema.lead.stageId, assignee: schema.lead.assignedUserId, notes: schema.contact.notes })
      .from(schema.lead)
      .innerJoin(schema.contact, eq(schema.contact.id, schema.lead.contactId))
      .where(eq(schema.lead.organizationId, org));
  };

  it("creates each new contact with its lead, by turn, in the given stage (AC4, AC5)", async () => {
    const { runImport } = await import("@/server/contacts-import");
    const file = csv("Nombre;Teléfono;Notas;Etapa\nUno;987000001;feria;Interesado\nDos;987000002;;\nTres;987000003;;etapa inventada\nAntigua;911000000;cambio;\nUno de nuevo;+51 987 000 001;;\n");
    const result = await runImport({ organizationId: org, actorUserId: "usr_owner", bytes: file, fileName: "lista.csv", mapping: null, countryCode: "51", assign: { kind: "rotation" } });
    expect(result.created).toBe(3);
    expect(result.counts).toEqual({ ok: 3, exists: 1, duplicate: 1, invalid_phone: 0 });
    expect(result.skipped.map((s) => [s.row, s.status])).toEqual([[5, "exists"], [6, "duplicate"]]);
    const leads = await leadsOf();
    const by = (n: string) => leads.find((l) => l.name === n);
    expect([by("Uno")?.assignee, by("Dos")?.assignee, by("Tres")?.assignee]).toEqual(["usr_ana", "usr_beto", "usr_ana"]);
    expect(by("Uno")).toMatchObject({ stageId: "stg_int", notes: "feria" });
    expect(by("Tres")?.stageId).toBe("stg_new");
  });

  it("never touches an existing contact and repeating creates nothing (D4)", async () => {
    const { getDb, schema } = await import("@/lib/db");
    const [old] = await getDb().select().from(schema.contact).where(eq(schema.contact.id, "ct_old"));
    expect(old).toMatchObject({ name: "Antigua", notes: "no tocar" });
    const { runImport } = await import("@/server/contacts-import");
    const again = await runImport({
      organizationId: org,
      actorUserId: "usr_owner",
      bytes: csv("Nombre,Teléfono\nUno,987000001\nDos,987000002\n"),
      fileName: "otra-vez.csv",
      mapping: null,
      countryCode: "51",
      assign: { kind: "rotation" },
    });
    expect(again).toMatchObject({ created: 0, counts: { ok: 0, exists: 2 } });
  });

  it("gives a rep their own imports; a supervisor can leave them unassigned or pick someone (D5)", async () => {
    const { runImport } = await import("@/server/contacts-import");
    const base = { organizationId: org, fileName: "x.csv", mapping: null, countryCode: "51" };
    await runImport({ ...base, actorUserId: "usr_beto", bytes: csv("Nombre,Celular\nDe Beto,987000010\n"), assign: { kind: "self", userId: "usr_beto" } });
    await runImport({ ...base, actorUserId: "usr_owner", bytes: csv("Nombre,Celular\nSin Dueño,987000011\n"), assign: { kind: "none" } });
    await runImport({ ...base, actorUserId: "usr_owner", bytes: csv("Nombre,Celular\nPara Ana,987000012\n"), assign: { kind: "user", userId: "usr_ana" } });
    const leads = await leadsOf();
    const by = (n: string) => leads.find((l) => l.name === n)?.assignee;
    expect([by("De Beto"), by("Sin Dueño"), by("Para Ana")]).toEqual(["usr_beto", null, "usr_ana"]);
  });

  it("previews without saving anything (D6)", async () => {
    const { previewImport } = await import("@/server/contacts-import");
    const before = (await leadsOf()).length;
    const preview = await previewImport({ organizationId: org, bytes: csv("Cliente,WhatsApp\nNueva,987000099\nUno,987000001\nMal,12\n"), fileName: "p.csv", mapping: null, countryCode: "51" });
    expect(preview.mapping).toMatchObject({ name: 0, phone: 1 });
    expect(preview.counts).toEqual({ ok: 1, exists: 1, duplicate: 0, invalid_phone: 1 });
    expect(preview.problems.map((p) => p.status)).toEqual(["exists", "invalid_phone"]);
    expect((await leadsOf()).length).toBe(before);
  });
});
