import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { TEST_DATABASE_URL, useTestDatabase } from "./test-db";

/** 1027 — El freno del proveedor, con chatJson de verdad y un proveedor simulado. */
describe.skipIf(!TEST_DATABASE_URL)("1027 — provider block notice", () => {
  let drop: () => Promise<void>;
  const org = "org_block";
  let respond: () => Response;
  let calls = 0;
  const ask = async () => {
    const { chatJson } = await import("@/lib/ai");
    return chatJson(z.object({ action: z.string() }), [{ role: "user", content: "hola" }], { organizationId: org });
  };
  const good = () => Response.json({ choices: [{ message: { content: '{"action":"none"}' } }] });

  beforeAll(async () => {
    ({ drop } = await useTestDatabase());
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    const { getDb, schema } = await import("@/lib/db");
    const { saveAiCredential } = await import("@/server/ai/credentials");
    await getDb().insert(schema.organization).values({ id: org, name: "Negocio" });
    await getDb().insert(schema.agentProfile).values({ id: "ap_block", organizationId: org, enabled: true });
    await saveAiCredential({
      organizationId: org,
      provider: "openrouter",
      baseUrl: "https://provider.test/api",
      model: "m",
      token: "sk-or-prueba-1234",
    });
    vi.stubGlobal("fetch", async () => {
      calls++;
      return respond();
    });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await drop?.();
  });

  it("AC1 y AC2 — un 403 avisa, no pausa y no reintenta", async () => {
    const { noticeIaOf } = await import("@/server/ai/notice");
    const { getAiCredentialPublic } = await import("@/server/ai/credentials");
    respond = () => new Response("Key limit exceeded", { status: 403 });
    calls = 0;
    expect((await ask()).ok).toBe(false);
    expect(calls).toBe(1);
    const cred = await getAiCredentialPublic(org);
    expect(cred).toMatchObject({ status: "active", blockedReason: "forbidden" });
    expect((await noticeIaOf(org))?.message).toContain("el proveedor de IA está rechazando");
  });

  it("AC3 — la siguiente respuesta buena lo quita sola", async () => {
    const { noticeIaOf } = await import("@/server/ai/notice");
    respond = good;
    expect((await ask()).ok).toBe(true);
    expect(await noticeIaOf(org)).toBeNull();
  });

  it("AC1 — el cupo agotado del central lo dice; una ráfaga no", async () => {
    const { noticeIaOf } = await import("@/server/ai/notice");
    const { clearBlocked } = await import("@/server/ai/credentials");
    respond = () => Response.json({ error: { code: "quota_exceeded" } }, { status: 429 });
    await ask();
    expect((await noticeIaOf(org))?.message).toContain("se agotó el cupo de IA");
    await clearBlocked(org);
    respond = () => new Response("slow down", { status: 429 });
    await ask();
    expect(await noticeIaOf(org)).toBeNull();
  });

  it("AC5 — «Probar conexión» lo limpia", async () => {
    const { noticeIaOf } = await import("@/server/ai/notice");
    const { markActive } = await import("@/server/ai/credentials");
    respond = () => new Response("", { status: 403 });
    await ask();
    await markActive(org);
    expect(await noticeIaOf(org)).toBeNull();
  });
});
