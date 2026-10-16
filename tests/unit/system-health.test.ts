import { describe, expect, it } from "vitest";
import { aiRow, brainRow, centralRow, mediaRow, summarizeHealth, whatsappRow, type HealthRow } from "@/server/system-health";

/** 1004 — Cómo se traduce cada chequeo a una fila de «Ajustes → Salud». */
describe("filas de salud", () => {
  it("archivos: escribible, no escribible u omitido", () => {
    expect(mediaRow({ dir: "/data/media", writable: true }).status).toBe("ok");
    expect(mediaRow({ dir: "/data/media", writable: false, code: "EACCES" })).toMatchObject({ status: "fail" });
    expect(mediaRow(null).status).toBe("skip");
  });

  it("WhatsApp: el peor de los números, omitido sin número", () => {
    expect(whatsappRow([]).status).toBe("skip");
    expect(whatsappRow([{ status: "ok", label: "a", detail: "…1234 ok" }, { status: "fail", label: "b", detail: "token vencido", fix: "reconecta" }])).toMatchObject({ status: "fail", fix: "reconecta" });
  });

  it("IA: activa con los últimos 4, sin configurar omitida, sin saldo en rojo (AC3)", () => {
    expect(aiRow({ active: true, source: "org", last4: "abcd" })).toMatchObject({ status: "ok", detail: "Llave guardada en Ajustes → IA (…abcd)" });
    expect(aiRow({ active: false, reason: "sin_configurar" }).status).toBe("skip");
    expect(aiRow({ active: false, reason: "sin_saldo", last4: "abcd", since: null }).status).toBe("fail");
  });

  it("cerebro externo: omitido sin configurar, rojo si su /health no responde", () => {
    expect(brainRow({ status: "skip", label: "BRAIN_DISPATCH_URL" }, null).status).toBe("skip");
    const down = brainRow({ status: "ok", label: "BRAIN_DISPATCH_URL", detail: "despacha a nea:8000" }, { reachable: false, host: "nea:8000", checkedAt: "" });
    expect(down).toMatchObject({ status: "fail" });
    expect(brainRow({ status: "ok", label: "x", detail: "despacha" }, { reachable: true, host: "nea:8000", checkedAt: "", version: "2.1.0" }).status).toBe("ok");
  });

  it("servicio central: sin llave avisa; con el último latido ok, bien", () => {
    const on = { status: "ok" as const, label: "INTO_CENTRAL_URL", detail: "late" };
    expect(centralRow({ status: "skip", label: "INTO_CENTRAL_URL", detail: "apagado" }, null).status).toBe("skip");
    expect(centralRow(on, null).status).toBe("warn");
    const license = { keyLast4: "1234", lastAttempt: null, lastResult: "ok", lastOk: null, plan: null, account: null } as unknown as Parameters<typeof centralRow>[1];
    expect(centralRow(on, license).status).toBe("ok");
  });

  it("el resumen cuenta fallas y avisos (AC2)", () => {
    const r = (status: HealthRow["status"]): HealthRow => ({ id: "ai", label: "x", status, detail: "" });
    expect(summarizeHealth([r("ok"), r("skip")]).text).toBe("Todo en orden");
    expect(summarizeHealth([r("warn")]).text).toBe("Funciona, con 1 aviso");
    expect(summarizeHealth([r("fail"), r("warn")]).text).toBe("1 con problemas y 1 con aviso");
  });
});
