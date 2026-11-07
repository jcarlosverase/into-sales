import { readFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL, useTestDatabase } from "./test-db";

/**
 * 1029 — Profesionales o recursos contra PostgreSQL real: los índices, el candado
 * y la carrera solo existen en la base.
 */
describe.skipIf(!TEST_DATABASE_URL)("1029 — agenda with professionals", () => {
  let drop: () => Promise<void>;
  const NOW = new Date("2026-11-09T05:00:00Z"); // lunes, medianoche en Lima
  const allDay = Object.fromEntries(
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, [{ start: "00:00", end: "23:30" }]])
  );
  let seq = 0;

  async function modules() {
    const { getDb, schema } = await import("@/lib/db");
    const service = await import("@/server/agenda/service");
    const resources = await import("@/server/agenda/resources");
    const { upsertSettings } = await import("@/server/agenda/settings");
    return { db: getDb(), schema, service, resources, upsertSettings };
  }

  /** Una organización nueva por prueba, abierta todo el día. */
  async function business(maxDaysAhead = 14) {
    const { db, schema, upsertSettings } = await modules();
    const org = `org_${++seq}`;
    await db.insert(schema.organization).values({ id: org, name: `Clínica ${seq}` });
    await upsertSettings(org, { weeklyHours: allDay, slotMinutes: 30, minNoticeHours: 0, maxDaysAhead });
    return org;
  }

  async function contact(org: string, name = "Ana") {
    const { db, schema } = await modules();
    const id = `ct_${++seq}`;
    await db.insert(schema.contact).values({ id, organizationId: org, waIdentity: `51900${seq}`, name });
    const conv = `cv_${seq}`;
    await db.insert(schema.conversation).values({ id: conv, organizationId: org, contactId: id });
    return { contactId: id, conversationId: conv };
  }

  const slot = (hour: number, minute = 0, day = 10) =>
    new Date(Date.UTC(2026, 10, day, hour + 5, minute)).toISOString();

  async function book(org: string, contactId: string, startUtc: string, resourceId?: string | null) {
    const { service } = await modules();
    return service.createSessionBooking({
      organizationId: org,
      contactId,
      startUtc,
      resourceId,
      source: "manual",
      requireOffer: false,
      now: NOW,
    });
  }

  beforeAll(async () => {
    ({ drop } = await useTestDatabase());
  });

  afterAll(async () => {
    await drop?.();
  });

  describe("migration 0032", () => {
    it("can run twice and changes no booking (AC28)", async () => {
      const { db, schema } = await modules();
      const org = await business();
      const { contactId } = await contact(org);
      const { booking } = await book(org, contactId, slot(9));
      const file = path.resolve(import.meta.dirname, "../../drizzle/0032_agenda_resources.sql");
      const statements = readFileSync(file, "utf8").split("--> statement-breakpoint");
      for (const statement of statements) await db.execute(sql.raw(statement));
      const rows = await db.select().from(schema.booking).where(eq(schema.booking.id, booking.id));
      expect(rows[0]).toMatchObject({ resourceId: null, status: "agendada" });
    });
  });

  describe("without professionals (H5)", () => {
    it("two bookings at the same instant still collide (AC26)", async () => {
      const org = await business();
      const { contactId } = await contact(org);
      await book(org, contactId, slot(9));
      await expect(book(org, contactId, slot(9))).rejects.toMatchObject({ code: "slot_taken" });
    });

    it("a booking keeps no professional", async () => {
      const org = await business();
      const { contactId } = await contact(org);
      const result = await book(org, contactId, slot(10));
      expect(result.booking.resourceId).toBeNull();
      expect(result.resource).toBeNull();
    });
  });

  describe("professionals (H1)", () => {
    it("copies the business hours and orders them (AC2)", async () => {
      const { resources } = await modules();
      const org = await business();
      const a = await resources.createResource(org, { kind: "person", name: "Ana" });
      const b = await resources.createResource(org, { kind: "person", name: "Luis" });
      expect(a.resource.weeklyHours.mon).toEqual(allDay.mon);
      expect([a.resource.position, b.resource.position]).toEqual([0, 1]);
    });

    it("the first one adopts future bookings, the second does not (AC4)", async () => {
      const { resources, db, schema } = await modules();
      const org = await business();
      const { contactId } = await contact(org);
      const { booking } = await book(org, contactId, slot(9));
      const first = await resources.createResource(org, { kind: "person", name: "Ana" }, NOW);
      expect(first.adoptedBookings).toBe(1);
      const second = await resources.createResource(org, { kind: "person", name: "Luis" }, NOW);
      expect(second.adoptedBookings).toBe(0);
      const rows = await db.select().from(schema.booking).where(eq(schema.booking.id, booking.id));
      expect(rows[0]?.resourceId).toBe(first.resource.id);
    });

    it("rejects a repeated active name, in any case", async () => {
      const { resources } = await modules();
      const org = await business();
      await resources.createResource(org, { kind: "person", name: "Ana" });
      await expect(resources.createResource(org, { kind: "person", name: "ANA" })).rejects.toMatchObject({
        code: "resource_name_taken",
      });
    });

    it("cannot archive someone with future bookings (AC5)", async () => {
      const { resources, service } = await modules();
      const org = await business();
      const { contactId } = await contact(org);
      const { resource } = await resources.createResource(org, { kind: "person", name: "Ana" });
      const { booking } = await book(org, contactId, slot(9), resource.id);
      await expect(resources.updateResource(org, resource.id, { active: false }, NOW)).rejects.toMatchObject({
        code: "resource_has_bookings",
        count: 1,
      });
      await service.cancelBooking({ organizationId: org, bookingId: booking.id });
      const archived = await resources.updateResource(org, resource.id, { active: false }, NOW);
      expect(archived.active).toBe(false);
    });

    it("archived, it is no longer offered and the business hours return", async () => {
      const { resources } = await modules();
      const { computeAvailability } = await import("@/server/agenda/availability");
      const org = await business();
      const { resource } = await resources.createResource(org, {
        kind: "person",
        name: "Ana",
        weeklyHours: { mon: [{ start: "09:00", end: "10:00" }] },
      });
      const withHer = await computeAvailability(org, { fromISO: "2026-11-10", toISO: "2026-11-10", now: NOW });
      expect(withHer).toHaveLength(0); // martes: no atiende
      await resources.updateResource(org, resource.id, { active: false }, NOW);
      const without = await computeAvailability(org, { fromISO: "2026-11-10", toISO: "2026-11-10", now: NOW });
      expect(without.length).toBeGreaterThan(0);
    });

    it("never crosses organizations", async () => {
      const { resources } = await modules();
      const mine = await business();
      const other = await business();
      const { contactId } = await contact(mine);
      const { resource } = await resources.createResource(other, { kind: "person", name: "Ajena" });
      expect(await resources.getResource(mine, resource.id)).toBeNull();
      await expect(book(mine, contactId, slot(9), resource.id)).rejects.toMatchObject({
        code: "resource_not_found",
      });
    });
  });

  describe("no double booking per professional (H2)", () => {
    async function twoPeople(maxDaysAhead = 14) {
      const { resources } = await modules();
      const org = await business(maxDaysAhead);
      const a = (await resources.createResource(org, { kind: "person", name: "Ana" })).resource;
      const b = (await resources.createResource(org, { kind: "person", name: "Luis" })).resource;
      const { contactId } = await contact(org);
      return { org, a, b, contactId };
    }

    it("two people share an instant (AC6)", async () => {
      const { org, a, b, contactId } = await twoPeople();
      await book(org, contactId, slot(9), a.id);
      const second = await book(org, contactId, slot(9), b.id);
      expect(second.resource?.name).toBe("Luis");
    });

    it("simultaneous bookings with one person: exactly one wins (AC7, SC-001)", async () => {
      const pairs = Number(process.env.RACE_PAIRS ?? 25);
      const { org, a, contactId } = await twoPeople(60);
      let won = 0;
      for (let i = 0; i < pairs; i++) {
        const day = Math.floor(i / 40);
        const start = new Date(
          Date.parse(slot(0, 0, 10)) + day * 86_400_000 + (i % 40) * 30 * 60_000
        ).toISOString();
        const results = await Promise.allSettled([
          book(org, contactId, start, a.id),
          book(org, contactId, start, a.id),
        ]);
        const fulfilled = results.filter((r) => r.status === "fulfilled");
        expect(fulfilled).toHaveLength(1);
        const rejected = results.find((r) => r.status === "rejected");
        expect((rejected as PromiseRejectedResult).reason).toMatchObject({ code: "slot_taken" });
        won += fulfilled.length;
      }
      expect(won).toBe(pairs);
    }, Number(process.env.RACE_PAIRS ?? 25) * 500 + 30_000);

    it("simultaneous bookings with two people both win", async () => {
      const { org, a, b, contactId } = await twoPeople();
      const results = await Promise.all([
        book(org, contactId, slot(11), a.id),
        book(org, contactId, slot(11), b.id),
      ]);
      expect(results.map((r) => r.resource?.name).sort()).toEqual(["Ana", "Luis"]);
    });

    it("without anyone chosen, someone free is assigned (AC21)", async () => {
      const { org, a, b, contactId } = await twoPeople();
      const first = await book(org, contactId, slot(9));
      const second = await book(org, contactId, slot(9));
      expect([first.booking.resourceId, second.booking.resourceId].sort()).toEqual([a.id, b.id].sort());
      await expect(book(org, contactId, slot(9))).rejects.toMatchObject({ code: "slot_taken" });
    });

    it("a block of one person leaves the other free (AC8)", async () => {
      const { service } = await modules();
      const { org, a, b, contactId } = await twoPeople();
      await service.createBlock({
        organizationId: org,
        startUtc: slot(9),
        durationMinutes: 60,
        resourceId: a.id,
      });
      await expect(book(org, contactId, slot(9), a.id)).rejects.toMatchObject({ code: "slot_taken" });
      expect((await book(org, contactId, slot(9), b.id)).resource?.id).toBe(b.id);
    });

    it("a block of the whole business takes everyone (AC8)", async () => {
      const { service } = await modules();
      const { org, a, b, contactId } = await twoPeople();
      await service.createBlock({ organizationId: org, startUtc: slot(9), durationMinutes: 60 });
      await expect(book(org, contactId, slot(9), a.id)).rejects.toMatchObject({ code: "slot_taken" });
      await expect(book(org, contactId, slot(9, 30), b.id)).rejects.toMatchObject({ code: "slot_taken" });
    });

    it("a business block on top of a professional's booking is rejected (AC9)", async () => {
      const { service } = await modules();
      const { org, a, contactId } = await twoPeople();
      await book(org, contactId, slot(9), a.id);
      await expect(
        service.createBlock({ organizationId: org, startUtc: slot(9), durationMinutes: 30 })
      ).rejects.toMatchObject({ code: "slot_taken" });
    });

    it("a business block racing a booking never ends up on top of it (D2)", async () => {
      const { service } = await modules();
      for (let i = 0; i < 10; i++) {
        const { org, a, contactId } = await twoPeople();
        const results = await Promise.allSettled([
          book(org, contactId, slot(9), a.id),
          service.createBlock({ organizationId: org, startUtc: slot(9), durationMinutes: 30 }),
        ]);
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      }
    });

    it("a booking without professional takes everyone (AC10)", async () => {
      const { db, schema } = await modules();
      const { org, a, b, contactId } = await twoPeople();
      await db.insert(schema.booking).values({
        id: `bk_old_${++seq}`,
        organizationId: org,
        contactId,
        scheduledAt: new Date(slot(9)),
        durationMinutes: 30,
      });
      await expect(book(org, contactId, slot(9), a.id)).rejects.toMatchObject({ code: "slot_taken" });
      await expect(book(org, contactId, slot(9), b.id)).rejects.toMatchObject({ code: "slot_taken" });
    });

    it("moving keeps the person, and can change it (AC15)", async () => {
      const { service } = await modules();
      const { org, a, b, contactId } = await twoPeople();
      const { booking } = await book(org, contactId, slot(9), a.id);
      const moved = await service.rescheduleBooking({
        organizationId: org,
        bookingId: booking.id,
        startUtc: slot(10),
        now: NOW,
      });
      expect(moved.booking.resourceId).toBe(a.id);
      const changed = await service.rescheduleBooking({
        organizationId: org,
        bookingId: booking.id,
        startUtc: slot(10),
        resourceId: b.id,
        now: NOW,
      });
      expect(changed.resource?.name).toBe("Luis");
    });
  });

  describe("the agent (H4)", () => {
    async function clinic(mode: "ask" | "first_free") {
      const { resources, upsertSettings } = await modules();
      const org = await business();
      await upsertSettings(org, { agentResourceMode: mode });
      const a = (await resources.createResource(org, { kind: "person", name: "Dra. Ana" })).resource;
      const b = (await resources.createResource(org, { kind: "person", name: "Dr. Luis" })).resource;
      const { conversationId } = await contact(org, "Paciente");
      return { org, a, b, conversationId };
    }

    const offersOf = async (org: string, conversationId: string) => {
      const { getOffers } = await import("@/server/agenda/offers");
      return getOffers(org, conversationId);
    };

    it("«ask»: the engine asks with real names and offers nothing (AC19)", async () => {
      const { offerSlots } = await import("@/server/agenda/agent");
      const { org, conversationId } = await clinic("ask");
      const turn = await offerSlots({ organizationId: org, conversationId });
      expect(turn.text).toBe("¿Con quién prefieres atenderte: Dra. Ana o Dr. Luis?");
      expect(await offersOf(org, conversationId)).toEqual([]);
    });

    it("«ask»: an invented id asks again (AC22)", async () => {
      const { offerSlots } = await import("@/server/agenda/agent");
      const { org, conversationId } = await clinic("ask");
      const turn = await offerSlots({ organizationId: org, conversationId, resourceId: "res_nope" });
      expect(turn.text).toContain("¿Con quién");
    });

    it("once chosen, offers and books with that person (AC20, AC23)", async () => {
      const { offerSlots, bookSlot } = await import("@/server/agenda/agent");
      const { org, a, conversationId } = await clinic("ask");
      const turn = await offerSlots({ organizationId: org, conversationId, resourceId: a.id });
      expect(turn.text).toContain("Con Dra. Ana");
      const offers = await offersOf(org, conversationId);
      expect(offers.every((o) => o.resourceId === a.id)).toBe(true);
      const booked = await bookSlot({
        organizationId: org,
        conversationId,
        startUtc: offers[0]!.startUtc,
      });
      expect(booked.ok).toBe(true);
      expect(booked.text).toContain("Te atiende Dra. Ana");
    });

    it("if it does not matter, offers everyone's (AC20)", async () => {
      const { offerSlots } = await import("@/server/agenda/agent");
      const { org, conversationId } = await clinic("ask");
      await offerSlots({ organizationId: org, conversationId, resourceId: "any" });
      const offers = await offersOf(org, conversationId);
      expect(offers.length).toBeGreaterThan(0);
      expect(offers.every((o) => !o.resourceId)).toBe(true);
    });

    it("«first free»: no question, no repeated instants, someone free (AC21)", async () => {
      const { offerSlots, bookSlot } = await import("@/server/agenda/agent");
      const { org, a, b, conversationId } = await clinic("first_free");
      const turn = await offerSlots({ organizationId: org, conversationId });
      expect(turn.text).not.toContain("¿Con quién");
      const offers = await offersOf(org, conversationId);
      expect(new Set(offers.map((o) => o.startUtc)).size).toBe(offers.length);
      await bookSlot({ organizationId: org, conversationId, startUtc: offers[0]!.startUtc });
      const { db, schema } = await modules();
      const rows = await db.select().from(schema.booking).where(eq(schema.booking.organizationId, org));
      expect([a.id, b.id]).toContain(rows[0]?.resourceId);
    });

    it("booking someone other than offered is slot_not_offered (AC22)", async () => {
      const { offerSlots } = await import("@/server/agenda/agent");
      const { service } = await modules();
      const { org, a, b, conversationId } = await clinic("ask");
      await offerSlots({ organizationId: org, conversationId, resourceId: a.id });
      const offers = await offersOf(org, conversationId);
      await expect(
        service.createSessionBooking({
          organizationId: org,
          conversationId,
          startUtc: offers[0]!.startUtc,
          resourceId: b.id,
          source: "ai",
          requireOffer: true,
        })
      ).rejects.toMatchObject({ code: "slot_not_offered" });
    });

    it("taken slot: alternatives of the same person (AC25)", async () => {
      const { offerSlots, bookSlot } = await import("@/server/agenda/agent");
      const { org, a, conversationId } = await clinic("ask");
      await offerSlots({ organizationId: org, conversationId, resourceId: a.id });
      const offers = await offersOf(org, conversationId);
      const start = offers[0]!.startUtc;
      const { contactId } = await contact(org, "Otro");
      await book(org, contactId, start, a.id).catch(async () => {
        // `book` usa un reloj fijo: con el reloj real se reserva por el servicio.
        const { service } = await modules();
        await service.createSessionBooking({
          organizationId: org,
          contactId,
          startUtc: start,
          resourceId: a.id,
          source: "manual",
          requireOffer: false,
        });
      });
      const turn = await bookSlot({ organizationId: org, conversationId, startUtc: start });
      expect(turn.ok).toBe(false);
      expect(turn.text).toContain("Se me acaba de ocupar");
      const fresh = await offersOf(org, conversationId);
      expect(fresh.length).toBeGreaterThan(0);
      expect(fresh.every((o) => o.resourceId === a.id)).toBe(true);
    });

    it("the person has no slots: says so and offers the others (AC25)", async () => {
      const { offerSlots } = await import("@/server/agenda/agent");
      const { resources } = await modules();
      const { org, a, conversationId } = await clinic("ask");
      await resources.updateResource(org, a.id, { weeklyHours: {} });
      const turn = await offerSlots({ organizationId: org, conversationId, resourceId: a.id });
      expect(turn.text).toContain("Dra. Ana no tiene horarios libres");
      const offers = await offersOf(org, conversationId);
      expect(offers.length).toBeGreaterThan(0);
      expect(offers.every((o) => !o.resourceId)).toBe(true);
    });

    it("a single professional is never asked about nor announced (AC13)", async () => {
      const { offerSlots, bookSlot } = await import("@/server/agenda/agent");
      const { resources, upsertSettings } = await modules();
      const org = await business();
      await upsertSettings(org, { agentResourceMode: "ask" });
      await resources.createResource(org, { kind: "person", name: "Dra. Ana" });
      const { conversationId } = await contact(org);
      const turn = await offerSlots({ organizationId: org, conversationId });
      expect(turn.text).not.toContain("¿Con quién");
      const offers = await offersOf(org, conversationId);
      const booked = await bookSlot({ organizationId: org, conversationId, startUtc: offers[0]!.startUtc });
      expect(booked.text).not.toContain("Te atiende");
    });

    it("the context says who and how (AC24)", async () => {
      const { offerSlots, bookSlot } = await import("@/server/agenda/agent");
      const { bookingsForContext } = await import("@/server/agenda/context");
      process.env.AGENDA = "on";
      const { org, a, conversationId } = await clinic("ask");
      await offerSlots({ organizationId: org, conversationId, resourceId: a.id });
      const offers = await offersOf(org, conversationId);
      await bookSlot({ organizationId: org, conversationId, startUtc: offers[0]!.startUtc });
      const { db, schema } = await modules();
      const rows = await db.select().from(schema.booking).where(eq(schema.booking.organizationId, org));
      const context = await bookingsForContext(org, rows[0]!.contactId!);
      expect(context?.next?.resource).toEqual({ id: a.id, name: "Dra. Ana" });
      expect(context?.resourceMode).toBe("ask");
      expect(context?.resources?.map((r) => r.name)).toEqual(["Dra. Ana", "Dr. Luis"]);
    });
  });

  it("availability with 20 people for 14 days stays fast (SC-004)", async () => {
    const { resources } = await modules();
    const { computeAvailability } = await import("@/server/agenda/availability");
    const org = await business();
    for (let i = 0; i < 20; i++) {
      await resources.createResource(org, { kind: "person", name: `Persona ${i}` });
    }
    await computeAvailability(org, { now: NOW });
    const start = performance.now();
    const slots = await computeAvailability(org, { now: NOW });
    const ms = performance.now() - start;
    console.log(`SC-004: ${slots.length} slots in ${ms.toFixed(0)} ms`);
    expect(slots.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(300);
  }, 30_000);
});
