import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { getDb } from "@/lib/db";
import { schema } from "@/lib/db";
import type { AiStatus } from "@/lib/ai/provider";

/**
 * #86 — Los pasos verificados de la guía de inicio, con la base falsa: cada
 * paso sale de la misma fuente que ya decide si esa pieza funciona (la fila
 * de Ajustes → IA o el entorno, el `status` de la conexión, el catálogo de
 * conectores), y lo que está MAL se dice en `problem`.
 */

const aiStatusOf = vi.hoisted(() => vi.fn<() => Promise<AiStatus>>());
vi.mock("@/lib/ai/provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/provider")>()),
  aiStatusOf: aiStatusOf,
}));

import { onboardingStatus } from "@/server/onboarding/status";
import { verifyCalendar, hasWeeklyHours } from "@/server/onboarding/calendar-verifiers";

// Identidades REALES de las tablas; solo se reemplaza el transporte.
const rows = new Map<unknown, unknown[]>();
const db = {
  select: () => ({
    from: (table: unknown) => {
      const query = {
        where: () => query,
        limit: () => query,
        then: (resolve: (value: unknown[]) => unknown) =>
          Promise.resolve(rows.get(table) ?? []).then(resolve),
      };
      return query;
    },
  }),
} as unknown as ReturnType<typeof getDb>;

const HOURS = { mon: [{ start: "09:00", end: "18:00" }] };
const stepValue = async (key: string) =>
  (await onboardingStatus("org_1", db)).steps.find((s) => s.key === key);

beforeEach(() => {
  rows.clear();
  vi.stubEnv("AGENDA", "");
  aiStatusOf.mockResolvedValue({ active: false, reason: "sin_configurar" });
  rows.set(schema.agentProfile, [{ name: "Asistente", instructions: null, enabled: false }]);
});
afterEach(() => vi.unstubAllEnvs());

describe("una instancia recién instalada", () => {
  it("tiene los tres pasos pendientes, la agenda no aplica y el agente apagado", async () => {
    const status = await onboardingStatus("org_1", db);
    expect(status.enabled).toBe(false);
    expect(status.steps.map((s) => [s.key, s.status])).toEqual([
      ["profile", "pending"],
      ["ai", "pending"],
      ["whatsapp", "pending"],
      ["calendar", "not_applicable"],
    ]);
    expect(status.steps.find((s) => s.key === "calendar")?.href).toBeNull();
    // Lo pendiente de un paso recién instalado no es un «problema».
    expect(status.steps.every((s) => s.problem === null)).toBe(true);
  });

  it("cada paso lleva a su pantalla", async () => {
    const status = await onboardingStatus("org_1", db);
    expect(status.steps.map((s) => s.href)).toEqual([
      "/agent",
      "/settings/ai",
      "/settings/whatsapp",
      null,
    ]);
  });
});

describe("paso 1: el agente", () => {
  it("está listo con instrucciones, o con conocimiento aunque no haya instrucciones", async () => {
    rows.set(schema.agentProfile, [{ name: "Sofi", instructions: "Vende limpiezas.", enabled: false }]);
    expect((await stepValue("profile"))?.status).toBe("ready");

    rows.set(schema.agentProfile, [{ name: "Sofi", instructions: "   ", enabled: false }]);
    rows.set(schema.kbEntry, [{ id: "kb_1" }]);
    expect((await stepValue("profile"))?.status).toBe("ready");
  });

  it("el nombre de fábrica no basta: sin instrucciones ni conocimiento sigue pendiente y dice qué falta", async () => {
    const step = await stepValue("profile");
    expect(step?.status).toBe("pending");
    expect(step?.nextAction).toMatch(/nombre/);
  });

  it("`enabled` sale del mismo perfil", async () => {
    rows.set(schema.agentProfile, [{ name: "Sofi", instructions: "x", enabled: true }]);
    expect((await onboardingStatus("org_1", db)).enabled).toBe(true);
  });
});

describe("paso 2: el proveedor de IA (la fila manda, el entorno es respaldo)", () => {
  it("la llave guardada en Ajustes → IA lo deja listo", async () => {
    aiStatusOf.mockResolvedValue({ active: true, source: "org", last4: "abcd" });
    const step = await stepValue("ai");
    expect(step).toMatchObject({ status: "ready", problem: null });
    expect(step?.nextAction).toMatch(/Ajustes/);
  });

  it("sin fila, OPENROUTER_* del entorno también cuenta", async () => {
    aiStatusOf.mockResolvedValue({ active: true, source: "env", last4: "abcd" });
    const step = await stepValue("ai");
    expect(step?.status).toBe("ready");
    expect(step?.nextAction).toMatch(/entorno/);
  });

  it("una llave pausada NO está lista y el problema se dice (rechazada o sin saldo)", async () => {
    aiStatusOf.mockResolvedValue({
      active: false,
      reason: "token_invalido",
      last4: "abcd",
      since: null,
    });
    const rejected = await stepValue("ai");
    expect(rejected?.status).toBe("pending");
    expect(rejected?.problem).toMatch(/rechazó/);

    aiStatusOf.mockResolvedValue({
      active: false,
      reason: "sin_saldo",
      last4: "abcd",
      since: null,
    });
    expect((await stepValue("ai"))?.problem).toMatch(/saldo/);
  });
});

describe("paso 3: WhatsApp", () => {
  it("conectado → listo", async () => {
    rows.set(schema.metaCredentials, [{ status: "connected" }]);
    expect(await stepValue("whatsapp")).toMatchObject({ status: "ready", problem: null });
  });

  it("token vencido → pendiente, y se dice que hay que reconectar", async () => {
    rows.set(schema.metaCredentials, [{ status: "reconnect_required" }]);
    const step = await stepValue("whatsapp");
    expect(step?.status).toBe("pending");
    expect(step?.problem).toMatch(/token/);
  });
});

describe("paso 4: la agenda, solo con AGENDA=on", () => {
  beforeEach(() => vi.stubEnv("AGENDA", "on"));

  it("sin horarios guardados está pendiente y lleva a Ajustes → Agenda", async () => {
    expect(await stepValue("calendar")).toMatchObject({
      status: "pending",
      href: "/settings/calendar",
      problem: null,
    });
  });

  it("enlace fijo con horarios → listo sin pedir credenciales de nadie", async () => {
    rows.set(schema.calendarSettings, [{ connector: "enlace-fijo", weeklyHours: HOURS }]);
    expect((await stepValue("calendar"))?.status).toBe("ready");
  });

  it("horarios vacíos (todos los días cerrados) → pendiente", async () => {
    rows.set(schema.calendarSettings, [{ connector: "enlace-fijo", weeklyHours: {} }]);
    expect((await stepValue("calendar"))?.status).toBe("pending");
  });

  it("un conector elegido sin credencial sigue pendiente y lo dice", async () => {
    rows.set(schema.calendarSettings, [{ connector: "zoom", weeklyHours: HOURS }]);
    const zoom = await stepValue("calendar");
    expect(zoom?.status).toBe("pending");
    expect(zoom?.problem).toMatch(/Zoom.*no está conectado/);

    rows.set(schema.calendarSettings, [{ connector: "google", weeklyHours: HOURS }]);
    expect((await stepValue("calendar"))?.problem).toMatch(/Google/);
  });

  it("con la credencial conectada → listo; rechazada por el proveedor → pendiente con el motivo", async () => {
    rows.set(schema.calendarSettings, [{ connector: "zoom", weeklyHours: HOURS }]);
    rows.set(schema.zoomCredentials, [{ status: "connected" }]);
    expect((await stepValue("calendar"))?.status).toBe("ready");

    rows.set(schema.zoomCredentials, [{ status: "error" }]);
    const broken = await stepValue("calendar");
    expect(broken?.status).toBe("pending");
    expect(broken?.problem).toMatch(/rechazó/);

    rows.set(schema.calendarSettings, [{ connector: "google", weeklyHours: HOURS }]);
    rows.set(schema.googleCredentials, [{ status: "connected" }]);
    expect((await stepValue("calendar"))?.status).toBe("ready");
  });

  it("un conector que no existe en esta instancia (venías de un fork) → unsupported", async () => {
    rows.set(schema.calendarSettings, [{ connector: "calendly", weeklyHours: HOURS }]);
    const step = await stepValue("calendar");
    expect(step?.status).toBe("unsupported");
    expect(step?.problem).toMatch(/calendly/);
  });
});

describe("verifyCalendar (pura)", () => {
  it("reconoce horarios bien formados y descarta los rotos", () => {
    expect(hasWeeklyHours(HOURS)).toBe(true);
    expect(hasWeeklyHours({ mon: [{ start: "18:00", end: "09:00" }] })).toBe(false);
    expect(hasWeeklyHours({ mon: [{ start: "9:00", end: "18:00" }] })).toBe(false);
    expect(hasWeeklyHours({ mon: [] })).toBe(false);
    expect(hasWeeklyHours(null)).toBe(false);
    expect(hasWeeklyHours("lunes")).toBe(false);
  });

  it("la tabla de decisión", () => {
    expect(verifyCalendar(undefined)).toBe("pending");
    expect(verifyCalendar({ connector: "enlace-fijo", weeklyHours: HOURS })).toBe("ready");
    expect(verifyCalendar({ connector: "zoom", weeklyHours: HOURS })).toBe("pending");
    expect(
      verifyCalendar({ connector: "zoom", weeklyHours: HOURS }, { zoom: true, google: false })
    ).toBe("ready");
    expect(
      verifyCalendar({ connector: "google", weeklyHours: HOURS }, { zoom: true, google: false })
    ).toBe("pending");
    expect(verifyCalendar({ connector: "otro", weeklyHours: HOURS })).toBe("unsupported");
    // Sin horarios manda lo pendiente, aunque el conector sea desconocido.
    expect(verifyCalendar({ connector: "otro", weeklyHours: {} })).toBe("pending");
  });
});
