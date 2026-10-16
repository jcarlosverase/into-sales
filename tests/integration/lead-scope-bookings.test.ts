import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL, useTestDatabase } from "./test-db";

/**
 * 022, D11–D12 (2026-10-15): a sales rep only sees their own contacts in
 * Citas and in the named lists of Resultados → higiene. Against PostgreSQL.
 */
describe.skipIf(!TEST_DATABASE_URL)("022 — bookings and hygiene by sales rep", () => {
  let drop: () => Promise<void>;
  const org = "org_scope";
  const owner = { kind: "all" } as const;
  const ana = { kind: "assigned", userId: "usr_ana" } as const;
  const now = new Date("2026-10-15T15:00:00Z");
  let ids: { anaBooking: string; betoBooking: string; block: string };

  beforeAll(async () => {
    ({ drop } = await useTestDatabase());
    const { getDb, schema } = await import("@/lib/db");
    const db = getDb();
    await db.insert(schema.organization).values({ id: org, name: "Academia Scope" });
    await db.insert(schema.user).values([
      { id: "usr_owner", name: "Dueña", email: "owner@scope.test" },
      { id: "usr_ana", name: "Ana", email: "ana@scope.test" },
      { id: "usr_beto", name: "Beto", email: "beto@scope.test" },
    ]);
    await db.insert(schema.member).values([
      { id: "mem_o", organizationId: org, userId: "usr_owner", role: "owner" },
      { id: "mem_a", organizationId: org, userId: "usr_ana", role: "member" },
      { id: "mem_b", organizationId: org, userId: "usr_beto", role: "member" },
    ]);
    await db.insert(schema.pipelineStage).values({ id: "stg_open", organizationId: org, name: "Nuevo", position: 0 });
    const old = new Date(now.getTime() - 10 * 86_400_000);
    const inbound21h = new Date(now.getTime() - 21 * 3_600_000);
    // `ana`/`beto`: silent for 10 days. `ana2`/`beto2`: their 24 h window closes soon.
    const people = [
      ["ana", "usr_ana", old],
      ["beto", "usr_beto", old],
      ["ana2", "usr_ana", inbound21h],
      ["beto2", "usr_beto", inbound21h],
    ] as const;
    for (const [who, user, lastInbound] of people) {
      await db.insert(schema.contact).values({ id: `ct_${who}`, organizationId: org, waIdentity: `51999${who}`, name: `Cliente de ${who}` });
      await db.insert(schema.lead).values({
        id: `ld_${who}`,
        organizationId: org,
        contactId: `ct_${who}`,
        stageId: "stg_open",
        assignedUserId: user,
        createdAt: old,
        lastActivityAt: old,
      });
      await db.insert(schema.conversation).values({
        id: `cv_${who}`,
        organizationId: org,
        contactId: `ct_${who}`,
        lastInboundAt: lastInbound,
        lastMessageAt: lastInbound,
      });
    }
    const at = (h: number) => new Date(now.getTime() + h * 3_600_000);
    await db.insert(schema.booking).values([
      { id: "bk_ana", organizationId: org, contactId: "ct_ana", scheduledAt: at(24), durationMinutes: 30 },
      { id: "bk_beto", organizationId: org, contactId: "ct_beto", scheduledAt: at(25), durationMinutes: 30 },
      { id: "bk_block", organizationId: org, kind: "block", scheduledAt: at(26), durationMinutes: 60 },
    ]);
    ids = { anaBooking: "bk_ana", betoBooking: "bk_beto", block: "bk_block" };
  });

  afterAll(async () => {
    await drop?.();
  });

  it("lists only the rep's bookings plus the blocks; supervisors see all (AC15)", async () => {
    const { listBookings, listBookingsInRange } = await import("@/server/agenda/queries");
    const idsOf = (rows: { id: string }[]) => rows.map((r) => r.id).sort();
    expect(idsOf(await listBookings(org, undefined, owner))).toEqual(["bk_ana", "bk_beto", "bk_block"]);
    expect(idsOf(await listBookings(org, undefined, ana))).toEqual(["bk_ana", "bk_block"]);
    const range = { from: "2026-10-15", to: "2026-10-17" };
    expect(idsOf((await listBookingsInRange(org, range, undefined, ana)).bookings)).toEqual(["bk_ana", "bk_block"]);
    expect(idsOf((await listBookingsInRange(org, range, undefined, owner)).bookings)).toEqual(["bk_ana", "bk_beto", "bk_block"]);
  });

  it("lets a rep act only on their own bookings and the blocks (AC16)", async () => {
    const { canSeeBooking, canSeeContact } = await import("@/server/leads/scope");
    expect(await canSeeBooking(ana, org, ids.anaBooking)).toBe(true);
    expect(await canSeeBooking(ana, org, ids.block)).toBe(true);
    expect(await canSeeBooking(ana, org, ids.betoBooking)).toBe(false);
    expect(await canSeeBooking(ana, "org_otra", ids.anaBooking)).toBe(false);
    expect(await canSeeBooking(owner, org, ids.betoBooking)).toBe(true);
    expect(await canSeeContact(ana, org, "ct_beto")).toBe(false);
  });

  it("shows a rep only their contacts in hygiene's named lists (AC17)", async () => {
    const { hygieneBlock } = await import("@/server/analytics/hygiene");
    const names = (rows: { name: string }[]) => rows.map((r) => r.name).sort();
    const all = await hygieneBlock(org, "PEN", now, owner);
    expect(names(all.silent)).toEqual(["Cliente de ana", "Cliente de beto"]);
    expect(names(all.closingWindows)).toEqual(["Cliente de ana2", "Cliente de beto2"]);
    const mine = await hygieneBlock(org, "PEN", now, ana);
    expect(names(mine.silent)).toEqual(["Cliente de ana"]);
    expect(mine.silentCount).toBe(1);
    expect(names(mine.closingWindows)).toEqual(["Cliente de ana2"]);
  });
});
