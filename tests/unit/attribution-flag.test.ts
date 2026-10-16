import { describe, expect, it } from "vitest";
import { parseAttributionFlag } from "@/server/attribution/flag";

/**
 * 016 — La bandera de la atribución. El caso que importa es el DEFAULT: una
 * instancia que no la pidió no debe acabar guardando identificadores de clic
 * de Meta ni mandándole eventos por un despiste de configuración.
 */

describe("parseAttributionFlag", () => {
  it("sin variable, la atribución no existe", () => {
    expect(parseAttributionFlag(undefined)).toBe(false);
    expect(parseAttributionFlag("")).toBe(false);
    expect(parseAttributionFlag("   ")).toBe(false);
  });

  it("`on` la enciende, con espacios y mayúsculas de por medio", () => {
    expect(parseAttributionFlag("on")).toBe(true);
    expect(parseAttributionFlag("ON")).toBe(true);
    expect(parseAttributionFlag("  On  ")).toBe(true);
  });

  it("acepta las otras formas de decir que sí", () => {
    expect(parseAttributionFlag("1")).toBe(true);
    expect(parseAttributionFlag("true")).toBe(true);
    expect(parseAttributionFlag("si")).toBe(true);
    expect(parseAttributionFlag("sí")).toBe(true);
    expect(parseAttributionFlag("yes")).toBe(true);
  });

  it("cualquier otra cosa la deja apagada, incluido `off` y `false`", () => {
    expect(parseAttributionFlag("off")).toBe(false);
    expect(parseAttributionFlag("false")).toBe(false);
    expect(parseAttributionFlag("0")).toBe(false);
    expect(parseAttributionFlag("no")).toBe(false);
    // Un typo no enciende nada: apagada es el estado seguro.
    expect(parseAttributionFlag("onn")).toBe(false);
  });
});
