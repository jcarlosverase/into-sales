import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_JOIN_PHRASE, DEFAULT_JOIN_REPLY } from "@/lib/stamp-card";
import { TEST_DATABASE_URL, useTestDatabase } from "./test-db";

/** 1023 — Programa y tarjetas contra PostgreSQL: alta, sellos, canje, ajuste e idempotencia. */
describe.skipIf(!TEST_DATABASE_URL)("1023 — stamp card domain", () => {
  let drop: () => Promise<void>;
  const org = "org_stamps";
  const other = "org_other";
  const program = {
    name: "Café La Esquina",
    stampsRequired: 3,
    reward: "1 bebida gratis",
    terms: null,
    color: "#0070e0",
    minHoursBetweenStamps: 4,
    joinPhrase: DEFAULT_JOIN_PHRASE,
    joinReply: DEFAULT_JOIN_REPLY,
    status: "active" as const,
  };
  const t0 = new Date("2026-11-05T15:00:00Z");
  const hours = (h: number) => new Date(t0.getTime() + h * 3_600_000);

  beforeAll(async () => {
    ({ drop } = await useTestDatabase());
    const { getDb, schema } = await import("@/lib/db");
    const db = getDb();
    await db.insert(schema.organization).values([
      { id: org, name: "Café" },
      { id: other, name: "Otra" },
    ]);
    await db.insert(schema.user).values({ id: "usr_ana", name: "Ana", email: "ana@stamps.test" });
    await db.insert(schema.contact).values([
      { id: "ct_luz", organizationId: org, waIdentity: "51900000001", phone: "51900000001", name: "Luz" },
      { id: "ct_max", organizationId: org, waIdentity: "51900000002", phone: "51900000002", name: "Max" },
      { id: "ct_far", organizationId: other, waIdentity: "51900000003", name: "Lejos" },
    ]);
  });

  afterAll(async () => {
    await drop?.();
  });

  it("sin programa no hay tarjeta", async () => {
    const { ensureCard, StampCardError } = await import("@/server/stamp-card/cards");
    await expect(ensureCard(org, "ct_luz", { source: "panel" })).rejects.toBeInstanceOf(StampCardError);
  });

  it("guardar el programa crea uno y luego sube la versión (D3)", async () => {
    const { saveProgram, getProgram } = await import("@/server/stamp-card/program");
    const first = await saveProgram(org, program);
    expect(first.version).toBe(1);
    const second = await saveProgram(org, { ...program, reward: "1 café" });
    expect(second.id).toBe(first.id);
    expect(second.version).toBe(2);
    expect((await getProgram(org))?.reward).toBe("1 café");
    expect(await getProgram(other)).toBeNull();
  });

  it("alta: crea una tarjeta por contacto y la reutiliza (AC3, D2)", async () => {
    const { ensureCard, publicCardUrl, findPublicCard } = await import("@/server/stamp-card/cards");
    const a = await ensureCard(org, "ct_luz", { source: "whatsapp", now: t0 });
    expect(a.created).toBe(true);
    expect(a.card).toMatchObject({ stamps: 0, stampsRequired: 3 });
    expect(a.card.serial).toMatch(/^[A-Za-z0-9]{22}$/);
    const [b, c] = await Promise.all([
      ensureCard(org, "ct_luz", { source: "whatsapp" }),
      ensureCard(org, "ct_luz", { source: "panel" }),
    ]);
    expect([b.created, c.created]).toEqual([false, false]);
    expect(b.card.id).toBe(a.card.id);
    // El enlace se puede volver a dar: es el mismo, y lleva a la tarjeta sin el contacto.
    const url = publicCardUrl(a.card.id);
    expect(publicCardUrl(a.card.id)).toBe(url);
    const token = url.split("/c/")[1]!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const found = await findPublicCard(token);
    expect(found?.card.id).toBe(a.card.id);
    expect(found?.program.name).toBe("Café La Esquina");
    expect(await findPublicCard("x".repeat(22))).toBeNull();
  });

  it("no crea tarjetas para un contacto de otra organización", async () => {
    const { ensureCard } = await import("@/server/stamp-card/cards");
    await expect(ensureCard(org, "ct_far", { source: "panel" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("sellar: idempotente, con freno de horas y confirmación (AC5, D7)", async () => {
    const { ensureCard, addStamp, listEvents } = await import("@/server/stamp-card/cards");
    const { card } = await ensureCard(org, "ct_luz", { source: "panel" });
    const base = { userId: "usr_ana", source: "panel" as const };
    const first = await addStamp(org, card.id, { ...base, idempotencyKey: "k1", now: hours(1) });
    expect(first).toMatchObject({ status: "ok", replayed: false, card: { stamps: 1 } });
    const again = await addStamp(org, card.id, { ...base, idempotencyKey: "k1", now: hours(1) });
    expect(again).toMatchObject({ status: "ok", replayed: true, card: { stamps: 1 } });
    // Dos a la vez con la misma llave: uno solo cuenta.
    await Promise.all([1, 2].map(() => addStamp(org, card.id, { ...base, idempotencyKey: "k2", now: hours(6) })));
    const soon = await addStamp(org, card.id, { ...base, idempotencyKey: "k3", now: hours(7) });
    expect(soon.status).toBe("needs_confirmation");
    if (soon.status === "needs_confirmation") expect(soon.nextAt).toEqual(hours(10));
    const forced = await addStamp(org, card.id, { ...base, idempotencyKey: "k3", now: hours(7), force: true });
    expect(forced).toMatchObject({ status: "ok", completed: true, card: { stamps: 3 } });
    const events = await listEvents(org, card.id);
    expect(events.map((e) => [e.kind, e.stampsAfter, e.forced])).toEqual([
      ["stamp", 3, true],
      ["stamp", 2, false],
      ["stamp", 1, false],
      ["join", 0, false],
    ]);
    expect(events[0]?.userName).toBe("Ana");
  });

  it("canjear deja el sobrante y toma los sellos del programa de hoy (AC6, D3)", async () => {
    const { getCardForContact, addStamp, redeemReward } = await import("@/server/stamp-card/cards");
    const { saveProgram } = await import("@/server/stamp-card/program");
    const card = (await getCardForContact(org, "ct_luz"))!;
    await addStamp(org, card.id, { userId: null, source: "qr", idempotencyKey: "k4", now: hours(20) });
    await saveProgram(org, { ...program, stampsRequired: 5 });
    const r = await redeemReward(org, card.id, { userId: "usr_ana", source: "panel", idempotencyKey: "r1" });
    expect(r).toMatchObject({ status: "ok", card: { stamps: 1, stampsRequired: 5, rewardsRedeemed: 1 } });
    await expect(redeemReward(org, card.id, { userId: "usr_ana", source: "panel", idempotencyKey: "r2" })).rejects.toMatchObject({
      code: "not_complete",
    });
    // Reintentar el canje que ya pasó no canjea otra vez.
    const replay = await redeemReward(org, card.id, { userId: "usr_ana", source: "panel", idempotencyKey: "r1" });
    expect(replay).toMatchObject({ status: "ok", replayed: true, card: { rewardsRedeemed: 1 } });
  });

  it("ajustar nunca deja sellos negativos", async () => {
    const { getCardForContact, adjustStamps } = await import("@/server/stamp-card/cards");
    const card = (await getCardForContact(org, "ct_luz"))!;
    const r = await adjustStamps(org, card.id, -9, { userId: "usr_ana", source: "panel", idempotencyKey: "a1" });
    expect(r).toMatchObject({ status: "ok", card: { stamps: 0 } });
  });

  it("en pausa no se sella ni se une nadie por WhatsApp, pero la ficha sí puede crearla", async () => {
    const { saveProgram } = await import("@/server/stamp-card/program");
    const { ensureCard, addStamp } = await import("@/server/stamp-card/cards");
    await saveProgram(org, { ...program, status: "paused" });
    await expect(ensureCard(org, "ct_max", { source: "whatsapp" })).rejects.toMatchObject({ code: "program_paused" });
    const { card } = await ensureCard(org, "ct_max", { source: "panel" });
    await expect(addStamp(org, card.id, { userId: null, source: "panel", idempotencyKey: "p1" })).rejects.toMatchObject({
      code: "program_paused",
    });
    await saveProgram(org, program);
  });

  it("otra organización no ve ni sella la tarjeta", async () => {
    const { getCardForContact, addStamp, getCard } = await import("@/server/stamp-card/cards");
    const card = (await getCardForContact(org, "ct_luz"))!;
    expect(await getCard(other, card.id)).toBeNull();
    await expect(addStamp(other, card.id, { userId: null, source: "panel", idempotencyKey: "x" })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("borrar el contacto borra su tarjeta y su bitácora", async () => {
    const { getDb, schema } = await import("@/lib/db");
    await getDb().delete(schema.contact).where(eq(schema.contact.id, "ct_max"));
    const rows = await getDb().select().from(schema.stampCard).where(eq(schema.stampCard.contactId, "ct_max"));
    expect(rows).toHaveLength(0);
  });
});
