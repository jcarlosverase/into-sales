import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encodeQr, qrSvg } from "@/lib/qr";

/**
 * 1023 (T004) — Las tres matrices fijadas aquí se leyeron con un
 * decodificador real (zxing-cpp) al escribir el generador. Si una cambia, el
 * QR dejó de ser el que se verificó: vuelve a leerlo antes de actualizar el hash.
 */
const fingerprint = (text: string) => {
  const { size, modules } = encodeQr(text);
  return { size, sha: createHash("sha256").update(modules.map((r) => r.map((b) => (b ? "1" : "0")).join("")).join("")).digest("hex") };
};
const sample = (n: number) => ("https://crm.cafe-la-esquina.pe/c/" + "AbC9_-xyzQ".repeat(70)).slice(0, n);

describe("encodeQr", () => {
  it("coincide con los QR verificados con un decodificador", () => {
    expect(fingerprint("https://wa.me/51999888777?text=" + encodeURIComponent("¡Quiero mi tarjeta de sellos!"))).toEqual({
      size: 37,
      sha: "3f7b5aa5ca010d07712cc67c4c5d5fe2279619afb8e958916878cbb43fa6fa94",
    });
    expect(fingerprint(sample(100))).toEqual({ size: 41, sha: "abc7303a325962dd0a1612bb25906ce2b75c5cf620912973bc83244fe542f191" });
    expect(fingerprint(sample(520))).toEqual({ size: 89, sha: "b1c1dad9e3e9edbd2e3cf8baa8f3e6f66d9653e92e2fc7efafbc8153146358e7" });
  });

  it("elige la versión más chica que alcanza", () => {
    expect(encodeQr("h").size).toBe(21);
    expect(encodeQr(sample(20)).size).toBe(25);
  });

  it("dibuja los tres patrones de búsqueda", () => {
    const { size, modules } = encodeQr("https://x.pe/c/abc");
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]] as const) {
      expect(modules[cy]![cx]).toBe(true);
      expect(modules[cy - 2]![cx]).toBe(false);
      expect(modules[cy - 3]![cx]).toBe(true);
    }
  });

  it("rechaza lo que no cabe en la versión 20", () => {
    expect(() => encodeQr("x".repeat(667))).toThrow(/no cabe/);
  });
});

describe("qrSvg", () => {
  it("un solo path, zona silenciosa de 4 y los colores pedidos", () => {
    const svg = qrSvg("hola", { dark: "#111111", light: "#fafafa" });
    expect(svg).toContain('viewBox="0 0 29 29"');
    expect(svg).toContain('fill="#111111"');
    expect(svg).toContain('fill="#fafafa"');
    expect(svg.match(/<path/g)).toHaveLength(1);
  });
});
