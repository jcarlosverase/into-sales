import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL, useTestDatabase } from "./test-db";

/** 1026 — El tope de 7 días con Better Auth de verdad, contra PostgreSQL. */
describe.skipIf(!TEST_DATABASE_URL)("1026 — absolute session limit", () => {
  let drop: () => Promise<void>;
  let cookie = "";
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;

  /** Lo que devuelve /get-session para el navegador con esa cookie. */
  async function getSession() {
    const { getAuth } = await import("@/lib/auth");
    return getAuth().api.getSession({ headers: new Headers({ cookie }) });
  }

  /** Lleva la fila a como estaría tras `ageMs` de vida, con la última renovación hace `sinceRefreshMs`. */
  async function age(ageMs: number, sinceRefreshMs = HOUR) {
    const { getDb, schema } = await import("@/lib/db");
    const { SESSION_EXPIRES_IN_SECONDS } = await import("@/lib/auth/session-policy");
    const now = Date.now();
    await getDb()
      .update(schema.session)
      .set({ createdAt: new Date(now - ageMs), expiresAt: new Date(now - sinceRefreshMs + SESSION_EXPIRES_IN_SECONDS * 1000) });
  }

  async function row() {
    const { getDb, schema } = await import("@/lib/db");
    const [found] = await getDb().select().from(schema.session);
    return found ?? null;
  }

  beforeAll(async () => {
    ({ drop } = await useTestDatabase());
    Object.assign(process.env, {
      APP_BASE_URL: "http://localhost:3000",
      BETTER_AUTH_SECRET: "integration-test-secret-0123456789",
      ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
      META_WEBHOOK_VERIFY_TOKEN: "integration-token",
    });
    const { getAuth } = await import("@/lib/auth");
    const res = await getAuth().api.signUpEmail({
      body: { email: "dueno@limit.test", password: "password-limit-123", name: "Dueño" },
      asResponse: true,
    });
    expect(res.ok).toBe(true);
    cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  });

  afterAll(async () => {
    await drop?.();
  });

  it("AC2 — con 2 días de vida, renovar vuelve a contar 12 horas", async () => {
    await age(2 * DAY);
    expect(await getSession()).not.toBeNull();
    const expires = (await row())!.expiresAt.getTime();
    expect(Math.abs(expires - (Date.now() + 12 * HOUR))).toBeLessThan(60_000);
  });

  it("AC3 — a 3 horas del tope, la renovación no pasa de los 7 días", async () => {
    await age(7 * DAY - 3 * HOUR);
    expect(await getSession()).not.toBeNull();
    const session = (await row())!;
    expect(session.expiresAt.getTime()).toBe(session.createdAt.getTime() + 7 * DAY);
  });

  it("AC1 y AC4 — pasados los 7 días vence, aunque esté en uso", async () => {
    await age(7 * DAY + HOUR);
    await getSession(); // La renovación la recorta a una fecha ya pasada.
    expect(await getSession()).toBeNull();
    expect(await row()).toBeNull();
  });
});
