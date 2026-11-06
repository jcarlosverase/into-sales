import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TEST_DATABASE_URL, useTestDatabase } from "./test-db";

/** 1025 — La renovación del token de Instagram contra PostgreSQL y una API simulada. */
describe.skipIf(!TEST_DATABASE_URL)("1025 — instagram token refresh", () => {
  let drop: () => Promise<void>;
  const now = new Date("2026-11-05T15:00:00Z");
  const days = (n: number) => new Date(now.getTime() + n * 86_400_000);
  const sixtyDays = 60 * 86_400;
  let calls: string[] = [];
  let respond: () => Response = () => Response.json({ access_token: "token-nuevo", expires_in: sixtyDays });

  async function account(org: string, input: { source?: "meta" | "zernio"; expires: Date | null }) {
    const { getDb, schema } = await import("@/lib/db");
    const { saveInstagramCredentials, getInstagramCredentialsByOrg } = await import("@/server/instagram/credentials");
    await getDb().insert(schema.organization).values({ id: org, name: org });
    await saveInstagramCredentials({
      organizationId: org,
      source: input.source ?? "meta",
      igUserId: `ig_${org}`,
      accountRef: null,
      username: null,
      token: `token-viejo-${org}`,
      webhookSecret: null,
      tokenExpiresAt: input.expires,
    });
    return (await getInstagramCredentialsByOrg(org))!;
  }

  beforeAll(async () => {
    ({ drop } = await useTestDatabase());
    process.env.IG_GRAPH_BASE_URL = "https://graph.test";
    vi.stubGlobal("fetch", async (url: string | URL) => {
      calls.push(String(url));
      return respond();
    });
  });

  afterEach(() => {
    calls = [];
    respond = () => Response.json({ access_token: "token-nuevo", expires_in: sixtyDays });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await drop?.();
  });

  it("decide por los días que le quedan", async () => {
    const { refreshDue } = await import("@/server/instagram/token-refresh");
    expect(refreshDue(days(45), now)).toBe(false);
    expect(refreshDue(days(20), now)).toBe(true);
    expect(refreshDue(days(-1), now)).toBe(true);
    expect(refreshDue(null, now)).toBe(true);
  });

  it("AC2 — renueva el que está por vencer y guarda el nuevo cifrado", async () => {
    const { refreshOne } = await import("@/server/instagram/token-refresh");
    const { getDb, schema } = await import("@/lib/db");
    const { getInstagramCredentialsByOrg } = await import("@/server/instagram/credentials");
    const creds = await account("org_due", { expires: days(10) });
    expect(await refreshOne(creds, now)).toBe("refreshed");
    expect(calls[0]).toContain("https://graph.test/refresh_access_token?grant_type=ig_refresh_token");
    const after = await getInstagramCredentialsByOrg("org_due");
    expect(after?.token).toBe("token-nuevo");
    expect(after?.tokenExpiresAt).toEqual(days(60));
    const [row] = await getDb().select().from(schema.instagramCredentials).where(eq(schema.instagramCredentials.organizationId, "org_due"));
    expect(JSON.stringify(row)).not.toContain("token-nuevo");
    expect(row?.tokenRefreshedAt).toEqual(now);
  });

  it("no llama a Instagram si falta mucho", async () => {
    const { refreshOne } = await import("@/server/instagram/token-refresh");
    expect(await refreshOne(await account("org_fresh", { expires: days(50) }), now)).toBe("not_due");
    expect(calls).toHaveLength(0);
  });

  it("AC4 — un fallo pasajero no cambia nada", async () => {
    const { refreshOne } = await import("@/server/instagram/token-refresh");
    const { getInstagramCredentialsByOrg } = await import("@/server/instagram/credentials");
    respond = () => new Response("boom", { status: 500 });
    expect(await refreshOne(await account("org_flaky", { expires: days(5) }), now)).toBe("failed");
    expect(await getInstagramCredentialsByOrg("org_flaky")).toMatchObject({ status: "connected", token: "token-viejo-org_flaky" });
  });

  it("AC5 — un token conocido que murió pide reconectar; uno pegado a mano, no", async () => {
    const { refreshOne } = await import("@/server/instagram/token-refresh");
    const { getInstagramCredentialsByOrg } = await import("@/server/instagram/credentials");
    respond = () => Response.json({ error: { message: "expired", code: 190 } }, { status: 400 });
    expect(await refreshOne(await account("org_dead", { expires: days(-2) }), now)).toBe("reconnect_required");
    expect((await getInstagramCredentialsByOrg("org_dead"))?.status).toBe("reconnect_required");
    expect(await refreshOne(await account("org_pasted", { expires: null }), now)).toBe("failed");
    expect((await getInstagramCredentialsByOrg("org_pasted"))?.status).toBe("connected");
  });

  it("AC3 y AC6 — la vuelta no toca a Zernio y aprende el vencimiento desconocido", async () => {
    const { refreshInstagramTokens } = await import("@/server/instagram/token-refresh");
    const { getInstagramCredentialsByOrg } = await import("@/server/instagram/credentials");
    await account("org_zernio", { source: "zernio", expires: null });
    await account("org_unknown", { expires: null });
    await refreshInstagramTokens(now);
    expect((await getInstagramCredentialsByOrg("org_zernio"))?.token).toBe("token-viejo-org_zernio");
    expect((await getInstagramCredentialsByOrg("org_unknown"))?.tokenExpiresAt).toEqual(days(60));
  });
});
