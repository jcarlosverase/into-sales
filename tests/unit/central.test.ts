import { describe, expect, it, vi } from "vitest";
import { ACCOUNT_LABEL, FORMAT_KEY, resultText } from "@/lib/central";
import { settingsSections } from "@/lib/nav";
import { heartbeatChecks, worstStatus } from "@/server/central/checks";
import { CHECK_IDS, sendHeartbeat, nextInterval, LICENSE_KEY_PATTERN, type BodyHeartbeat } from "@/server/central/client";
import { readConfigCentral } from "@/server/central/flag";
import { checkCentral } from "@/server/doctor/checks";
import { healthFeatures } from "@/server/health";

const KEY = "into_live_" + "A".repeat(28) + "1234";
const BODY: BodyHeartbeat = {
  app_version: "1.5.0",
  app_started_at: "2026-10-14T03:00:00.000Z",
  checks: [{ id: "database", status: "ok" }],
};
const response = (status: number, body: unknown) =>
  async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

describe("028 — bandera INTO_CENTRAL_URL (D1)", () => {
  it("apagada sin la variable; encendida con una URL http(s)", () => {
    expect(readConfigCentral({})).toEqual({ active: false, host: null, problem: null });
    expect(readConfigCentral({ INTO_CENTRAL_URL: "  " })).toMatchObject({ active: false, problem: null });
    expect(readConfigCentral({ INTO_CENTRAL_URL: "https://api.into.center/" })).toEqual({
      active: true,
      url: "https://api.into.center",
      host: "api.into.center",
    });
    expect(readConfigCentral({ INTO_CENTRAL_URL: "http://localhost:3011" })).toMatchObject({ active: true, url: "http://localhost:3011" });
  });

  it("mal escrita queda inactiva y lo dice, sin tumbar nada", () => {
    for (const raw of ["api.into.center", "ftp://api.into.center", "https://u:p@api.into.center"]) {
      expect(readConfigCentral({ INTO_CENTRAL_URL: raw })).toMatchObject({ active: false, problem: "url" });
    }
    expect(checkCentral({ INTO_CENTRAL_URL: "nope" }).status).toBe("warn");
    expect(checkCentral({}).status).toBe("skip");
    expect(checkCentral({ INTO_CENTRAL_URL: "https://api.into.center" })).toMatchObject({ status: "ok", detail: expect.stringContaining("api.into.center") });
  });

  it("decide si existen «Plan» y features.central (AC1)", () => {
    const business = (central: boolean) => settingsSections({ central }).find((s) => s.title === "Negocio")!.links.map((l) => l.label);
    expect(business(false)).not.toContain("Plan");
    expect(business(true)).toContain("Plan");
    expect(healthFeatures({}).central).toBe(false);
    expect(healthFeatures({ INTO_CENTRAL_URL: "https://api.into.center" }).central).toBe(true);
    expect(healthFeatures({ INTO_CENTRAL_URL: "mal" }).central).toBe(false);
  });
});

describe("028 — adaptador del central (contrato de into-central)", () => {
  it("manda el cuerpo con la llave solo en la cabecera", async () => {
    const fetchImpl = vi.fn(
      response(200, { customer: { name: "A", status: "active" }, plan: { code: "CE-PYM", name: "Pyme" }, next_heartbeat_seconds: 900 }),
    );
    const r = await sendHeartbeat({ url: "https://api.into.center", key: KEY, body: BODY, fetchImpl });
    expect(r).toEqual({ ok: true, response: expect.objectContaining({ plan: { code: "CE-PYM", name: "Pyme" } }) });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.into.center/v1/heartbeat");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(String(init.body)).not.toContain(KEY);
    expect(JSON.parse(String(init.body))).toEqual(BODY);
  });

  it("traduce cada respuesta a un resultado cerrado, sin la llave (AC4, AC6)", async () => {
    const testCases: [() => Promise<Response>, string][] = [
      [response(401, { error: {} }), "llave_invalida"],
      [response(429, { error: {} }), "limite"],
      [response(400, { error: {} }), "rechazado"],
      [response(500, "boom"), "sin_respuesta"],
      [response(200, { raro: true }), "sin_respuesta"],
      [response(200, "no es json"), "sin_respuesta"],
      [
        async () => {
          throw new TypeError(`fetch failed ${KEY}`);
        },
        "sin_respuesta",
      ],
    ];
    for (const [fetchImpl, expected] of testCases) {
      const r = await sendHeartbeat({ url: "https://x", key: KEY, body: BODY, fetchImpl });
      expect(r).toMatchObject({ ok: false, result: expected });
      expect(JSON.stringify(r)).not.toContain(KEY);
    }
  });

  it("acota el intervalo que pide el central (D5)", () => {
    expect(nextInterval(undefined)).toBe(900);
    expect(nextInterval(null)).toBe(900);
    expect(nextInterval(5)).toBe(60);
    expect(nextInterval(900)).toBe(900);
    expect(nextInterval(86400)).toBe(3600);
  });

  it("reconoce el formato de la llave del central", () => {
    expect(LICENSE_KEY_PATTERN.test(KEY)).toBe(true);
    expect(FORMAT_KEY.test(KEY)).toBe(true);
    for (const bad of ["into_live_corta", `into_test_${"A".repeat(32)}`, `${KEY}x`, ""]) {
      expect(LICENSE_KEY_PATTERN.test(bad)).toBe(false);
    }
  });
});

describe("028 — chequeos del latido (D3)", () => {
  it("manda solo los cinco ids y su estado, nunca el detalle", async () => {
    const checks = await heartbeatChecks("org_1", {
      mediaDir: async () => ({ writable: true }),
      whatsapp: async () => [
        { status: "ok", label: "WhatsApp +51 999 (Org)", detail: "token …abcd" },
        { status: "fail", label: "WhatsApp +51 888 (Org)", detail: "token vencido" },
      ],
      ia: async () => ({ active: false, reason: "sin_configurar" }),
      dispatch: () => ({ status: "skip", label: "BRAIN_DISPATCH_URL" }),
    });
    expect(checks).toEqual([
      { id: "database", status: "ok" },
      { id: "media_dir", status: "ok" },
      { id: "whatsapp", status: "fail" },
      { id: "ai", status: "skip" },
      { id: "dispatch", status: "skip" },
    ]);
    expect(checks.map((c) => c.id)).toEqual([...CHECK_IDS]);
    expect(JSON.stringify(checks)).not.toMatch(/999|abcd|vencido|Org/);
  });

  it("un chequeo que revienta va como aviso y el latido sale igual (D4)", async () => {
    const checks = await heartbeatChecks("org_1", {
      mediaDir: async () => null,
      whatsapp: async () => {
        throw new Error("BD caída");
      },
      ia: async () => ({ active: false, reason: "token_invalido" }),
      dispatch: () => ({ status: "warn", label: "BRAIN_DISPATCH_URL" }),
    });
    expect(checks).toEqual([
      { id: "database", status: "ok" },
      { id: "media_dir", status: "skip" },
      { id: "whatsapp", status: "warn" },
      { id: "ai", status: "fail" },
      { id: "dispatch", status: "warn" },
    ]);
  });

  it("el peor estado manda", () => {
    expect(worstStatus(["ok", "warn", "skip"])).toBe("warn");
    expect(worstStatus(["ok", "fail", "warn"])).toBe("fail");
    expect(worstStatus(["skip"])).toBe("skip");
    expect(worstStatus([])).toBe("skip");
  });
});

describe("028 — textos de Ajustes → Plan", () => {
  it("dice qué pasó en el último latido", () => {
    expect(resultText(null)).toBeNull();
    expect(resultText("ok")?.tone).toBe("ok");
    expect(resultText("llave_invalida")?.text).toMatch(/no reconoce esta llave/);
    expect(resultText("sin_respuesta")?.text).toMatch(/Sin respuesta del central.*sigue funcionando/);
    expect(ACCOUNT_LABEL).toEqual({ active: "Activa", suspended: "Suspendida" });
  });
});
