import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL, useTestDatabase } from "./test-db";

/** 1024 — Un lead sin asignar entra al reparto cuando el cliente vuelve a escribir. */
describe.skipIf(!TEST_DATABASE_URL)("1024 — returning unassigned lead", () => {
  let drop: () => Promise<void>;
  const org = "org_returning";
  const at = new Date("2026-11-05T15:00:00Z");
  let seq = 0;

  /** Un contacto con su lead sin vendedor, en la etapa pedida. */
  async function unassignedLead(stageId = "stg_open", assignedUserId: string | null = null) {
    const { getDb, schema } = await import("@/lib/db");
    const n = ++seq;
    await getDb().insert(schema.contact).values({ id: `ct_${n}`, organizationId: org, waIdentity: `5190000${n}`, name: `Cliente ${n}` });
    await getDb().insert(schema.lead).values({ id: `lead_${n}`, organizationId: org, contactId: `ct_${n}`, stageId, position: n, assignedUserId });
    return { contactId: `ct_${n}`, leadId: `lead_${n}` };
  }

  async function ownerOf(leadId: string) {
    const { getDb, schema } = await import("@/lib/db");
    const [row] = await getDb().select().from(schema.lead).where(eq(schema.lead.id, leadId));
    return row!.assignedUserId;
  }

  async function lastTurn() {
    const { getDb, schema } = await import("@/lib/db");
    const [row] = await getDb().select().from(schema.leadRouting).where(eq(schema.leadRouting.organizationId, org));
    return row?.lastAssignedUserId ?? null;
  }

  beforeAll(async () => {
    ({ drop } = await useTestDatabase());
    const { getDb, schema } = await import("@/lib/db");
    const db = getDb();
    await db.insert(schema.organization).values({ id: org, name: "Negocio" });
    await db.insert(schema.user).values([
      { id: "usr_a", name: "Ana", email: "ana@returning.test" },
      { id: "usr_b", name: "Beto", email: "beto@returning.test" },
    ]);
    await db.insert(schema.member).values([
      { id: "mem_a", organizationId: org, userId: "usr_a", role: "member", createdAt: new Date("2026-01-01") },
      { id: "mem_b", organizationId: org, userId: "usr_b", role: "member", createdAt: new Date("2026-01-02") },
    ]);
    await db.insert(schema.pipelineStage).values([
      { id: "stg_open", organizationId: org, name: "Nuevo", position: 0, kind: "open" },
      { id: "stg_won", organizationId: org, name: "Ganado", position: 1, kind: "won" },
    ]);
  });

  afterAll(async () => {
    await drop?.();
  });

  it("AC1 — un lead abierto sin vendedor toma el siguiente turno", async () => {
    const { onLeadActivity } = await import("@/server/inbox/lead-activity");
    const first = await unassignedLead();
    const second = await unassignedLead();
    await onLeadActivity(org, first.contactId, at);
    await onLeadActivity(org, second.contactId, at);
    expect(await ownerOf(first.leadId)).toBe("usr_a");
    expect(await ownerOf(second.leadId)).toBe("usr_b");
  });

  it("AC2 — un lead con vendedor no cambia ni gasta turno", async () => {
    const { onLeadActivity } = await import("@/server/inbox/lead-activity");
    const before = await lastTurn();
    const { contactId, leadId } = await unassignedLead("stg_open", "usr_a");
    await onLeadActivity(org, contactId, at);
    expect(await ownerOf(leadId)).toBe("usr_a");
    expect(await lastTurn()).toBe(before);
  });

  it("AC3 — un lead cerrado no entra al reparto", async () => {
    const { onLeadActivity } = await import("@/server/inbox/lead-activity");
    const before = await lastTurn();
    const { contactId, leadId } = await unassignedLead("stg_won");
    await onLeadActivity(org, contactId, at);
    expect(await ownerOf(leadId)).toBeNull();
    expect(await lastTurn()).toBe(before);
  });

  it("AC5 — dos mensajes a la vez gastan un solo turno", async () => {
    const { onLeadActivity } = await import("@/server/inbox/lead-activity");
    const before = await lastTurn();
    const { contactId, leadId } = await unassignedLead();
    await Promise.all([onLeadActivity(org, contactId, at), onLeadActivity(org, contactId, at)]);
    const owner = await ownerOf(leadId);
    expect(owner).not.toBeNull();
    expect(owner).not.toBe(before);
    expect(await lastTurn()).toBe(owner);
  });

  it("AC4 — con el reparto apagado sigue sin asignar", async () => {
    const { onLeadActivity } = await import("@/server/inbox/lead-activity");
    const { updateRoutingSettings } = await import("@/server/leads/routing");
    await updateRoutingSettings(org, { enabled: false });
    const { contactId, leadId } = await unassignedLead();
    await onLeadActivity(org, contactId, at);
    expect(await ownerOf(leadId)).toBeNull();
    await updateRoutingSettings(org, { enabled: true });
  });
});
