import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ACCENT_PRESETS,
  DEFAULT_BRANDING,
  resolveAccentSet,
  resolveNavAccentSet,
} from "@/lib/branding";

/**
 * R8 — Pisos de contraste de los dos temas, medidos sobre los tokens REALES de
 * globals.css (no sobre una copia). El tema oscuro de antes pasaba todas las
 * pruebas y aun así se veía plano: barra y página a 1.04:1, chip y panel a
 * 1.01:1. Aquí vive cada par que importa con su piso, para que un retoque de
 * color que lo rompa truene en `pnpm test` y no en una captura.
 *
 * Pisos: texto de lectura ≥ 4.5:1 (WCAG AA); iconos, rellenos y anillo de
 * foco ≥ 3:1 (1.4.11); y para superficies y bordes, el escalón mínimo que se
 * alcanza a ver (≈ 1.1–1.25:1 entre superficies, ≥ 1.4:1 un borde).
 */

type Vars = Record<string, string>;

function luminance(hex: string): number {
  const ch = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Variables de un bloque de globals.css, con el valor sin saltos de línea. */
function block(css: string, selector: string): Vars {
  const start = css.indexOf(selector);
  expect(start, `no está el bloque ${selector}`).toBeGreaterThanOrEqual(0);
  const body = css
    .slice(css.indexOf("{", start) + 1, css.indexOf("}", start))
    .replace(/\/\*[\s\S]*?\*\//g, ""); // un comentario puede nombrar un token
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [
      m[1]!,
      m[2]!.replace(/\s+/g, " ").trim(),
    ])
  );
}

const css = readFileSync("src/app/globals.css", "utf8");
const light = block(css, ":root {");
const darkRaw = block(css, ':root[data-theme="dark"] {');
const nav = block(css, ".nav-dark {");

/** Tokens del tema oscuro: lo que el bloque no redeclara viene de `:root`. */
const dark: Vars = { ...light, ...darkRaw };

/** Resuelve `var(--x)` contra el mismo bloque (un nivel alcanza aquí). */
function hex(vars: Vars, name: string): string {
  const v = vars[name];
  expect(v, `falta ${name}`).toBeDefined();
  const ref = /^var\((--[\w-]+)\)$/.exec(v!)?.[1];
  const value = ref ? vars[ref] : v;
  expect(value, `${name} no es un hex`).toMatch(/^#[0-9a-f]{6}$/i);
  return value!.toLowerCase();
}

/** Afirma un piso con un mensaje que dice el par y su valor. */
function floor(vars: Vars, a: string, b: string, min: number) {
  const c = contrast(hex(vars, a), hex(vars, b));
  expect(c, `${a} sobre ${b}: ${c.toFixed(2)} (piso ${min})`).toBeGreaterThanOrEqual(min);
}

/** `a` es la superficie MÁS CLARA de las dos. */
function top(vars: Vars, a: string, b: string) {
  expect(
    luminance(hex(vars, a)),
    `${a} debería ir un escalón arriba de ${b}`
  ).toBeGreaterThan(luminance(hex(vars, b)));
}

describe("tema oscuro: el bicolor no desaparece", () => {
  it("la barra es claramente más oscura que la página (≥ 1.25:1)", () => {
    // La barra pinta `bg-subtle` DENTRO de `.nav-dark`; la página, `--bg`.
    const bar = hex(nav, "--bg-subtle");
    const page = hex(dark, "--bg");
    expect(luminance(bar)).toBeLessThan(luminance(page));
    expect(contrast(bar, page)).toBeGreaterThanOrEqual(1.25);
    // …y el hueco de la página (hilo, columnas) tampoco se confunde con ella.
    expect(contrast(bar, hex(dark, "--bg-subtle"))).toBeGreaterThanOrEqual(1.1);
  });

  it("en claro la barra sigue siendo azul marino sobre blanco", () => {
    expect(contrast(hex(nav, "--bg-subtle"), hex(light, "--bg"))).toBeGreaterThanOrEqual(15);
  });
});

describe("tema oscuro: escalera de superficies", () => {
  it("hueco < página < fila bajo el cursor ≈ lo que flota < chip < panel < hover", () => {
    top(dark, "--bg", "--bg-subtle");
    top(dark, "--row-hover", "--bg");
    top(dark, "--bg-raised", "--bg");
    top(dark, "--chip-bg", "--row-hover");
    top(dark, "--bg-panel", "--chip-bg");
    top(dark, "--bg-panel", "--bg-raised");
    top(dark, "--bg-hover", "--bg-panel");
  });

  it("cada escalón se ve", () => {
    floor(dark, "--bg", "--bg-subtle", 1.1);
    floor(dark, "--row-hover", "--bg", 1.07);
    floor(dark, "--bg-raised", "--bg", 1.08);
    // Un botón secundario (bg-secondary) dentro de un diálogo o un cajón.
    floor(dark, "--bg-panel", "--bg-raised", 1.1);
    floor(dark, "--bg-panel", "--bg", 1.2);
    floor(dark, "--chip-bg", "--bg", 1.15);
    floor(dark, "--chip-bg", "--row-hover", 1.07);
    floor(dark, "--bg-hover", "--bg", 1.35);
    // El contador dentro de un chip de filtro (bg-secondary sobre bg-chip):
    // antes 1.01:1, el círculo no se veía.
    floor(dark, "--bg-panel", "--chip-bg", 1.1);
    // Como en claro (1.03:1), el hover de un botón secundario es sutil.
    floor(dark, "--bg-hover", "--bg-panel", 1.05);
    floor(dark, "--bg-hover", "--bg-raised", 1.25);
    // 215 — el horario no hábil contra la rejilla (bg-card = --bg).
    floor(dark, "--bg", "--cal-off", 1.08);
  });

  it("los bordes separan (≥ 1.6:1 en la página, ≥ 1.4:1 en lo que flota)", () => {
    floor(dark, "--border", "--bg", 1.6);
    floor(dark, "--border", "--bg-subtle", 1.5);
    floor(dark, "--border", "--bg-raised", 1.4);
    floor(dark, "--border-strong", "--bg", 2.2);
    floor(dark, "--border-strong", "--bg-raised", 2);
  });

  it("las burbujas se despegan del hilo", () => {
    floor(dark, "--bubble-in", "--chat-bg", 1.3);
    floor(dark, "--bubble-in-border", "--chat-bg", 2);
    floor(dark, "--accent-tint", "--chat-bg", 1.3); // --bubble-out
    floor(dark, "--text", "--bubble-in", 7);
    floor(dark, "--text", "--accent-tint", 7);
  });
});

describe("tema oscuro: texto", () => {
  const surfaces = [
    "--bg-subtle",
    "--bg",
    "--row-hover",
    "--bg-raised",
    "--bg-panel",
    "--chip-bg",
    "--bg-hover",
    "--accent-tint",
  ];

  it("texto, secundario y terciario pasan AA sobre TODA superficie", () => {
    // `text-3` incluido: es el de la `.kicker` (10.5px) y de las horas.
    for (const s of surfaces) {
      floor(dark, "--text", s, 7);
      floor(dark, "--text-2", s, 4.5);
      floor(dark, "--text-3", s, 4.5);
    }
  });

  it("text-4 alcanza para iconos (≥ 3:1), no para leer", () => {
    for (const s of ["--bg", "--bg-raised", "--bg-panel", "--accent-tint"]) {
      floor(dark, "--text-4", s, 3);
    }
  });

  it("las tríadas de estado se leen sobre su propio fondo", () => {
    for (const e of ["success", "warning", "danger", "info"]) {
      floor(dark, `--${e}-text`, `--${e}-tint`, 4.5);
      floor(dark, `--${e}-text`, "--bg", 4.5);
      top(dark, `--${e}-tint`, "--bg");
      floor(dark, `--${e}-soft`, `--${e}-tint`, 1.3);
    }
    floor(dark, "--danger-fg", "--danger", 4.5);
  });
});

describe("tema oscuro: acento", () => {
  const set = resolveAccentSet(DEFAULT_BRANDING.accent, "dark");

  it("el respaldo de globals.css es el que calcula lib/branding", () => {
    // Si alguien retoca la receta y no el respaldo (o al revés), el primer
    // pintado sin white-label sale de otro color que el resto.
    expect(hex(dark, "--accent")).toBe(set.accent);
    expect(hex(dark, "--accent-hover")).toBe(set.hover);
    expect(hex(dark, "--accent-soft")).toBe(set.soft);
    expect(hex(dark, "--accent-tint")).toBe(set.tint);
    expect(hex(dark, "--accent-text")).toBe(set.text);
    expect(hex(dark, "--accent-fg")).toBe(set.fg);
  });

  it("la fila seleccionada se ve sin leer el color del texto (tint ≥ 1.25:1)", () => {
    floor(dark, "--accent-tint", "--bg", 1.25);
    floor(dark, "--accent-soft", "--bg", 1.5);
  });

  it("el acento rellena (≥ 3:1) y su tinta se lee (≥ 4.5:1)", () => {
    floor(dark, "--accent", "--bg", 3);
    floor(dark, "--accent-fg", "--accent", 4.5);
    for (const s of ["--bg", "--bg-raised", "--accent-tint"]) {
      floor(dark, "--accent-ink", s, 4.5); // una hora, un enlace, «IA»
    }
  });

  it("el anillo de foco se ve donde hay algo enfocable (≥ 3:1)", () => {
    for (const s of ["--bg-subtle", "--bg", "--bg-raised", "--bg-panel", "--accent-tint"]) {
      floor(dark, "--ring", s, 3);
    }
  });
});

describe("tema claro: no cambia", () => {
  it("lo que flota, la tinta y el anillo del acento son los de siempre", () => {
    expect(light["--bg-raised"]).toBe(light["--bg"]);
    expect(light["--accent-ink"]).toBe("var(--accent)");
    expect(light["--ring"]).toBe("var(--accent)");
  });

  it("la barra (.nav-dark) conserva sus valores: se ve igual en los dos temas", () => {
    // Son los que tenía cuando copiaba al tema oscuro de antes; si la barra
    // cambia, cambia también en claro, que es el tema que al dueño le gusta.
    expect(nav).toMatchObject({
      "--bg": "#0b1327",
      "--bg-subtle": "#070e20",
      "--bg-panel": "#131f3d",
      "--bg-hover": "#182750",
      "--text": "#e8eefc",
      "--text-2": "#a9b8dc",
      "--text-3": "#7688b0",
      "--border": "#263866",
      "--border-strong": "#34498a",
      "--ring": "var(--accent)",
    });
    expect(css).toMatch(/\.nav-dark \{\s*color-scheme: dark;/);
  });

  it("dentro de la barra el texto se lee", () => {
    floor(nav, "--text", "--bg-subtle", 7);
    floor(nav, "--text-2", "--bg-hover", 4.5);
    floor(nav, "--text-3", "--bg-subtle", 4.5);
  });
});

describe("tinta sobre el acento: blanca solo si pasa AA (≥ 4.5:1)", () => {
  // Presets + colores que un negocio sí elige: un verde (antes 3.3:1 con
  // blanco), un amarillo, un rojo, un morado, un gris y un azul profundo.
  const accents = [
    ...Object.keys(ACCENT_PRESETS),
    "#16a34a",
    "#f59e0b",
    "#e11d48",
    "#7c3aed",
    "#6b7280",
    "#12305a",
    "#ffee88",
  ];

  it("en los dos temas y en la barra", () => {
    for (const a of accents) {
      for (const [where, s] of [
        ["claro", resolveAccentSet(a, "light")],
        ["oscuro", resolveAccentSet(a, "dark")],
        ["barra", resolveNavAccentSet(a)],
      ] as const) {
        const c = contrast(s.fg, s.accent);
        expect(c, `${a} en ${where}: ${c.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("un acento claro lleva tinta oscura en vez de oscurecerse más", () => {
    const green = resolveAccentSet("#16a34a", "light");
    expect(green.accent).toBe("#16a34a");
    expect(green.fg).not.toBe("#ffffff");
  });

  it("en oscuro cada acento se despega de la página y su tinta se lee", () => {
    const page = hex(dark, "--bg");
    for (const a of accents) {
      const s = resolveAccentSet(a, "dark");
      expect(contrast(s.accent, page), `${a}: relleno`).toBeGreaterThanOrEqual(3);
      expect(contrast(s.text, s.tint), `${a}: tinta sobre tint`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(s.text, page), `${a}: tinta sobre la página`).toBeGreaterThanOrEqual(4.5);
      // El tono ayuda (un rojo se distingue del azul marino aunque su
      // luminancia se le acerque); el azul Vocero lleva su propio piso, 1.25.
      expect(contrast(s.tint, page), `${a}: tint`).toBeGreaterThanOrEqual(1.1);
    }
  });

  it("en la barra, el acento se calcula contra SU fondo (≥ 3.5:1)", () => {
    for (const a of accents) {
      const s = resolveNavAccentSet(a);
      expect(contrast(s.accent, hex(nav, "--bg")), a).toBeGreaterThanOrEqual(3.5);
      expect(contrast(s.text, s.tint), `${a}: tinta sobre tint`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
