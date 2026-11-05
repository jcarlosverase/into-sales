import { describe, expect, it } from "vitest";
import {
  applyAdjust,
  applyRedeem,
  applyStamp,
  canStamp,
  DEFAULT_JOIN_PHRASE,
  DEFAULT_JOIN_REPLY,
  matchesJoinPhrase,
  normalizePhrase,
  programInputSchema,
  renderJoinReply,
  stampsLeft,
  waJoinLink,
} from "@/lib/stamp-card";
import { parseStampCardFlag } from "@/server/stamp-card/flag";
import { firstName } from "@/server/stamp-card/join";

const valid = {
  name: "Café La Esquina",
  stampsRequired: 10,
  reward: "1 bebida gratis",
  terms: "Un sello por compra",
  color: "#0070E0",
  minHoursBetweenStamps: 4,
  joinPhrase: DEFAULT_JOIN_PHRASE,
  joinReply: DEFAULT_JOIN_REPLY,
  status: "active" as const,
};

describe("bandera STAMP_CARD", () => {
  it("mismos valores que AGENDA", () => {
    expect(parseStampCardFlag("on")).toBe(true);
    expect(parseStampCardFlag(" Sí ")).toBe(true);
    expect(parseStampCardFlag(undefined)).toBe(false);
    expect(parseStampCardFlag("onn")).toBe(false);
  });
});

describe("programInputSchema (AC2)", () => {
  it("acepta un programa válido y normaliza el color", () => {
    const r = programInputSchema.parse(valid);
    expect(r.color).toBe("#0070e0");
    expect(r.terms).toBe("Un sello por compra");
  });

  it("condiciones vacías quedan en null", () => {
    expect(programInputSchema.parse({ ...valid, terms: "  " }).terms).toBeNull();
    expect(programInputSchema.parse({ ...valid, terms: null }).terms).toBeNull();
  });

  it.each([
    ["nombre vacío", { name: " " }],
    ["nombre largo", { name: "x".repeat(41) }],
    ["1 sello", { stampsRequired: 1 }],
    ["31 sellos", { stampsRequired: 31 }],
    ["sellos con decimales", { stampsRequired: 5.5 }],
    ["premio largo", { reward: "x".repeat(61) }],
    ["condiciones largas", { terms: "x".repeat(301) }],
    ["color sin #", { color: "0070e0" }],
    ["horas negativas", { minHoursBetweenStamps: -1 }],
    ["más de una semana", { minHoursBetweenStamps: 169 }],
    ["frase solo signos", { joinPhrase: "¡¿!?" }],
    ["respuesta sin enlace", { joinReply: "Hola {nombre}" }],
    ["estado archivado", { status: "archived" }],
    ["campo de más", { extra: 1 }],
  ])("rechaza %s", (_, patch) => {
    expect(programInputSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});

describe("frase de alta (D4)", () => {
  it("ignora mayúsculas, tildes, signos y espacios", () => {
    expect(normalizePhrase("  ¡Quiero mi TARJETA   de sellós!! ")).toBe("quiero mi tarjeta de sellos");
    expect(matchesJoinPhrase("quiero mi tarjeta de sellos", DEFAULT_JOIN_PHRASE)).toBe(true);
    expect(matchesJoinPhrase("¿Quiero mi tarjeta, de sellos?", DEFAULT_JOIN_PHRASE)).toBe(true);
  });

  it("no basta con contenerla", () => {
    expect(matchesJoinPhrase("Hola, quiero mi tarjeta de sellos por favor", DEFAULT_JOIN_PHRASE)).toBe(false);
    expect(matchesJoinPhrase("", "¡!")).toBe(false);
  });
});

describe("canStamp (D7)", () => {
  const last = new Date("2026-11-05T10:00:00Z");
  it("sin freno o sin sello previo, siempre", () => {
    expect(canStamp(null, 4, last)).toEqual({ ok: true });
    expect(canStamp(last, 0, last)).toEqual({ ok: true });
  });
  it("en el borde exacto, sí; un milisegundo antes, no", () => {
    expect(canStamp(last, 4, new Date("2026-11-05T14:00:00Z"))).toEqual({ ok: true });
    const r = canStamp(last, 4, new Date("2026-11-05T13:59:59.999Z"));
    expect(r).toEqual({ ok: false, reason: "too_soon", nextAt: new Date("2026-11-05T14:00:00Z") });
  });
});

describe("sellos y canje (H5)", () => {
  it("el sello completa la tarjeta y puede pasarse", () => {
    expect(applyStamp({ stamps: 9, stampsRequired: 10 })).toEqual({ stamps: 10, stampsRequired: 10, complete: true });
    expect(applyStamp({ stamps: 10, stampsRequired: 10 }).stamps).toBe(11);
  });
  it("canjear deja el sobrante y toma los sellos del programa de hoy (D3)", () => {
    expect(applyRedeem({ stamps: 11, stampsRequired: 10 }, 8)).toEqual({ ok: true, stamps: 1, stampsRequired: 8, delta: -10 });
  });
  it("sin la tarjeta completa, no hay canje", () => {
    expect(applyRedeem({ stamps: 9, stampsRequired: 10 }, 10)).toEqual({ ok: false, reason: "not_complete" });
  });
  it("un ajuste nunca deja sellos negativos", () => {
    expect(applyAdjust({ stamps: 2, stampsRequired: 10 }, -5)).toEqual({ stamps: 0, delta: -2 });
    expect(applyAdjust({ stamps: 2, stampsRequired: 10 }, 3)).toEqual({ stamps: 5, delta: 3 });
  });
  it("cuántos faltan", () => {
    expect(stampsLeft({ stamps: 4, stampsRequired: 10 })).toBe(6);
    expect(stampsLeft({ stamps: 12, stampsRequired: 10 })).toBe(0);
  });
});

describe("textos", () => {
  it("renderJoinReply reemplaza las tres variables y deja lo demás", () => {
    expect(renderJoinReply("Hola {nombre}, {negocio}: {enlace} {otro}", { nombre: "Ana", negocio: "Café", enlace: "https://x/c/t" })).toBe(
      "Hola Ana, Café: https://x/c/t {otro}"
    );
  });
  it("sin nombre, {nombre} se va con su espacio", () => {
    expect(renderJoinReply("Hola {nombre}, tu tarjeta: {enlace}", { nombre: "", negocio: "Café", enlace: "u" })).toBe("Hola, tu tarjeta: u");
  });
  it("firstName: el primer nombre, o nada si es un teléfono", () => {
    expect(firstName("  Luz María Pérez ")).toBe("Luz");
    expect(firstName("ClienteZDW2")).toBe("ClienteZDW2");
    expect(firstName("+51 999 888 777")).toBe("");
    expect(firstName("")).toBe("");
  });
  it("waJoinLink deja solo dígitos y codifica la frase", () => {
    expect(waJoinLink("+51 999 888 777", "¡Quiero mi tarjeta!")).toBe(
      "https://wa.me/51999888777?text=%C2%A1Quiero%20mi%20tarjeta!"
    );
  });
});

describe("1023, H7 — contexto de la tarjeta para el agente", () => {
  it("dice cuántos lleva, cuántos faltan y que no prometa sellos", async () => {
    const { stampCardContext } = await import("@/server/ai/prompts");
    const text = stampCardContext({
      programName: "Café La Esquina",
      reward: "1 bebida gratis",
      stamps: 7,
      stampsRequired: 10,
      paused: false,
      url: "https://crm.example/c/abc",
    });
    expect(text).toMatch(/lleva 7 de 10 sellos/);
    expect(text).toMatch(/Le faltan 3 para «1 bebida gratis»/);
    expect(text).toMatch(/https:\/\/crm\.example\/c\/abc/);
    expect(text).toMatch(/NO prometas sellos/);
    const done = stampCardContext({ programName: "X", reward: "R", stamps: 12, stampsRequired: 10, paused: true, url: "u" });
    expect(done).toMatch(/lleva 10 de 10/);
    expect(done).toMatch(/Ya la completó/);
    expect(done).toMatch(/en pausa/);
  });
});
