import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { featureLines } from "@/lib/about";
import { LICENSE_NAME, LICENSE_TEXT } from "@/lib/license";

describe("1000 — Acerca de", () => {
  it("la licencia incrustada es idéntica a LICENSE (AC5)", () => {
    expect(LICENSE_TEXT).toBe(readFileSync("LICENSE", "utf8"));
    expect(LICENSE_NAME).toBe("MIT");
    expect(LICENSE_TEXT).toMatch(/^MIT License/);
  });

  it("dice qué módulos están encendidos, con las banderas de /api/health (AC3)", () => {
    expect(featureLines({ agenda: false, channels: ["whatsapp"], atribucion: false, central: false })).toEqual([
      { label: "Canales", on: true, detail: "WhatsApp" },
      { label: "Agenda y citas", on: false, detail: "Apagada" },
      { label: "Atribución de anuncios", on: false, detail: "Apagada" },
      { label: "Servicio central de into", on: false, detail: "Apagado" },
    ]);
    const on = featureLines({ agenda: true, channels: ["whatsapp", "instagram", "tiktok"], atribucion: true, central: true });
    expect(on.map((l) => l.on)).toEqual([true, true, true, true]);
    expect(on[0]!.detail).toBe("WhatsApp, Instagram, TikTok");
    expect(on[3]!.detail).toBe("Conectado");
  });
});
