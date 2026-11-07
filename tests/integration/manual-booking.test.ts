import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL, useTestDatabase } from "./test-db";

/** 1029, AC33: a manual booking takes the contact's real conversation. */
describe.skipIf(!TEST_DATABASE_URL)("1029 — conversation of a manual booking", () => {
  let drop: () => Promise<void>;
  const org = "org_manual";

  beforeAll(async () => {
    ({ drop } = await useTestDatabase());
    const { getDb, schema } = await import("@/lib/db");
    const db = getDb();
    await db.insert(schema.organization).values([
      { id: org, name: "Clínica" },
      { id: "org_other", name: "Otra" },
    ]);
    await db.insert(schema.contact).values([
      { id: "ct_a", organizationId: org, waIdentity: "51999000001", name: "Ana" },
      { id: "ct_new", organizationId: org, waIdentity: "51999000002", name: "Sin chat" },
      { id: "ct_lab", organizationId: org, waIdentity: "51999000004", name: "Solo Laboratorio" },
      { id: "ct_x", organizationId: "org_other", waIdentity: "51999000003", name: "Ajena" },
    ]);
    const at = (d: string) => new Date(`2026-11-${d}T15:00:00Z`);
    await db.insert(schema.conversation).values([
      { id: "cv_real", organizationId: org, contactId: "ct_a", lastMessageAt: at("01") },
      { id: "cv_lab", organizationId: org, contactId: "ct_a", isTest: true, lastMessageAt: at("05") },
      { id: "cv_only_lab", organizationId: org, contactId: "ct_lab", isTest: true, lastMessageAt: at("05") },
      { id: "cv_x", organizationId: "org_other", contactId: "ct_x", lastMessageAt: at("05") },
    ]);
  });

  afterAll(async () => {
    await drop?.();
  });

  it("takes the real conversation, never the Lab's", async () => {
    const { contactConversationId } = await import("@/server/agenda/service");
    expect(await contactConversationId(org, "ct_a")).toBe("cv_real");
    expect(await contactConversationId(org, "ct_lab")).toBeNull();
  });

  it("is null for a contact without conversations", async () => {
    const { contactConversationId } = await import("@/server/agenda/service");
    expect(await contactConversationId(org, "ct_new")).toBeNull();
  });

  it("never crosses organizations", async () => {
    const { contactConversationId } = await import("@/server/agenda/service");
    expect(await contactConversationId(org, "ct_x")).toBeNull();
  });
});
