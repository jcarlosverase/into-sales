import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_JOIN_PHRASE, DEFAULT_JOIN_REPLY } from "@/lib/stamp-card";
import { TEST_DATABASE_URL, useTestDatabase } from "./test-db";

/**
 * 1023, D10 — El aviso por WhatsApp al completar la tarjeta: texto libre con
 * la ventana abierta, la plantilla elegida si está cerrada, nada si no hay
 * plantilla. El envío a Meta se reemplaza: aquí importa qué se decide mandar.
 */
const sent = vi.hoisted(() => ({ texts: [] as string[], templates: [] as { templateId: string; variables?: string[] }[], windowOpen: true }));

vi.mock("@/server/inbox/send", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/inbox/send")>();
  return {
    ...real,
    sendText: async (input: { text: string }) => {
      if (!sent.windowOpen) throw new real.SendError("window_closed", "Ventana cerrada");
      sent.texts.push(input.text);
      return { messageId: "msg_x" };
    },
  };
});
vi.mock("@/server/whatsapp/templates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/whatsapp/templates")>()),
  sendTemplate: async (input: { templateId: string; variables?: string[] }) => {
    sent.templates.push({ templateId: input.templateId, variables: input.variables });
    return { messageId: "msg_t" };
  },
}));
vi.mock("@/server/stamp-card/wallet-sync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/stamp-card/wallet-sync")>()),
  kickWalletSync: () => undefined,
  kickProgramSync: () => undefined,
}));

describe.skipIf(!TEST_DATABASE_URL)("1023, D10 — aviso al completar", () => {
  let drop: () => Promise<void>;
  const org = "org_complete";
  const base = {
    name: "Café La Esquina",
    stampsRequired: 2,
    reward: "1 bebida gratis",
    terms: null,
    color: "#0070e0",
    minHoursBetweenStamps: 0,
    joinPhrase: DEFAULT_JOIN_PHRASE,
    joinReply: DEFAULT_JOIN_REPLY,
    status: "active" as const,
  };
  let cardId = "";

  beforeAll(async () => {
    ({ drop } = await useTestDatabase());
    const { getDb, schema } = await import("@/lib/db");
    const db = getDb();
    await db.insert(schema.organization).values({ id: org, name: "Café" });
    await db.insert(schema.contact).values({ id: "ct_ana", organizationId: org, waIdentity: "51900000021", phone: "51900000021", name: "Ana Ruiz" });
    await db.insert(schema.conversation).values({ id: "cv_ana", organizationId: org, contactId: "ct_ana", lastInboundAt: new Date() });
    await db.insert(schema.template).values({
      id: "tpl_done",
      organizationId: org,
      name: "tarjeta_completa",
      language: "es",
      category: "UTILITY",
      body: "{{1}}, completaste tu tarjeta en {{2}}.",
      status: "approved",
    });
    const { saveProgram } = await import("@/server/stamp-card/program");
    await saveProgram(org, { ...base, notifyOnComplete: true, completeTemplateId: "tpl_done" });
    const { ensureCard } = await import("@/server/stamp-card/cards");
    cardId = (await ensureCard(org, "ct_ana", { source: "panel" })).card.id;
  });

  afterAll(async () => {
    await drop?.();
  });

  beforeEach(() => {
    sent.texts = [];
    sent.templates = [];
    sent.windowOpen = true;
  });

  it("con la ventana abierta manda texto libre con el nombre, el negocio y el premio", async () => {
    const { notifyCardComplete } = await import("@/server/stamp-card/complete");
    expect(await notifyCardComplete(org, cardId)).toBe("sent_text");
    expect(sent.texts).toEqual(["¡Ana, completaste tu tarjeta de sellos de Café La Esquina! 🎉 Pide tu premio en tu próxima visita: 1 bebida gratis."]);
  });

  it("con la ventana cerrada usa la plantilla elegida", async () => {
    const { notifyCardComplete } = await import("@/server/stamp-card/complete");
    sent.windowOpen = false;
    expect(await notifyCardComplete(org, cardId)).toBe("sent_template");
    expect(sent.templates).toEqual([{ templateId: "tpl_done", variables: ["Ana", "Café La Esquina", "1 bebida gratis"] }]);
  });

  it("sin plantilla y con la ventana cerrada no manda nada; apagado, tampoco", async () => {
    const { saveProgram } = await import("@/server/stamp-card/program");
    const { notifyCardComplete } = await import("@/server/stamp-card/complete");
    sent.windowOpen = false;
    await saveProgram(org, { ...base, notifyOnComplete: true, completeTemplateId: null });
    expect(await notifyCardComplete(org, cardId)).toBe("skipped");
    sent.windowOpen = true;
    await saveProgram(org, { ...base, notifyOnComplete: false });
    expect(await notifyCardComplete(org, cardId)).toBe("skipped");
    expect(sent.texts).toEqual([]);
    expect(sent.templates).toEqual([]);
  });

  it("guardar sin tocar el aviso lo deja como estaba", async () => {
    const { saveProgram, getProgram } = await import("@/server/stamp-card/program");
    await saveProgram(org, { ...base, notifyOnComplete: true, completeTemplateId: "tpl_done" });
    await saveProgram(org, { ...base, reward: "1 café" });
    expect(await getProgram(org)).toMatchObject({ notifyOnComplete: true, completeTemplateId: "tpl_done", reward: "1 café" });
  });
});
