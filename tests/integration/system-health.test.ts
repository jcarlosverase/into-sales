import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL, useTestDatabase } from "./test-db";

/** 1004 — La salud del CRM contra PostgreSQL real. */
describe.skipIf(!TEST_DATABASE_URL)("1004 — system health against PostgreSQL", () => {
  let drop: () => Promise<void>;
  beforeAll(async () => {
    ({ drop } = await useTestDatabase());
  });
  afterAll(async () => {
    await drop?.();
  });

  it("base de datos y migraciones en verde, sin mostrar la URL (AC1, AC3)", async () => {
    const { runSystemHealth } = await import("@/server/system-health");
    const rows = await runSystemHealth("org_none", {
      env: {},
      media: async () => ({ dir: "/tmp/x", writable: true }),
      whatsapp: async () => [],
      ai: async () => ({ active: false, reason: "sin_configurar" }),
      brainHealth: async () => null,
    });
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId.database).toMatchObject({ status: "ok" });
    expect(byId.database!.detail).toMatch(/Responde en \d+ ms · PostgreSQL/);
    expect(byId.migrations!.status).toBe("ok");
    expect(byId.central!.status).toBe("skip");
    expect(JSON.stringify(rows)).not.toContain(process.env.DATABASE_URL!);
  });

  it("si un chequeo lanza, sale en rojo y la página sigue (AC4)", async () => {
    const { runSystemHealth } = await import("@/server/system-health");
    const rows = await runSystemHealth("org_none", {
      env: {},
      media: async () => { throw new Error("disco lleno"); },
      whatsapp: async () => [],
      ai: async () => ({ active: false, reason: "sin_configurar" }),
      brainHealth: async () => null,
    });
    expect(rows.find((r) => r.id === "media")).toMatchObject({ status: "fail", detail: "No se pudo comprobar: disco lleno" });
    expect(rows).toHaveLength(7);
  });
});
