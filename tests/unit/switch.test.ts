import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Switch } from "@/components/ui/switch";

/**
 * El interruptor compartido (#53).
 *
 * El del Agente y el de «IA en esta conversación» eran dos copias a mano y
 * divergieron dos veces: primero el pomo perdió su sombra; después el del
 * Agente quedó `absolute` sin `left`, arrancaba del CENTRO de la pista y
 * encendido se salía. Aquí se fija la geometría —con las clases de Tailwind,
 * una unidad son 4 px— y que no vuelva a aparecer otra copia.
 *
 * Si estás leyendo esto porque se puso rojo: no copies el interruptor,
 * extiende `components/ui/switch.tsx`.
 */

const SRC = path.resolve(import.meta.dirname, "..", "..", "src");
const UNIQUE = path.join(SRC, "components", "ui", "switch.tsx");

function files(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

type Props = Parameters<typeof Switch>[0];

function draw(props: Partial<Props> = {}): string {
  return renderToStaticMarkup(
    createElement(Switch, {
      checked: false,
      onCheckedChange: () => {},
      label: "Prueba",
      ...props,
    })
  );
}

/** Clases de la pista (el `<button>`) y del pomo (su `<span>`). */
function classes(html: string): { pista: string[]; knob: string[] } {
  const de = (re: RegExp) => re.exec(html)?.[1]?.split(/\s+/) ?? [];
  return {
    pista: de(/<button[^>]*class="([^"]*)"/),
    knob: de(/<span[^>]*class="([^"]*)"/),
  };
}

/** `w-11` → 44 px, `px-0.5` → 2 px, `translate-x-5` → 20 px; sin la clase, 0. */
function px(list: string[], prefix: string): number {
  const c = list.find((x) => x.startsWith(prefix));
  return c ? Number(c.slice(prefix.length)) * 4 : 0;
}

describe("interruptor: el pomo no se sale de la pista (#53)", () => {
  for (const size of ["md", "sm"] as const) {
    it(`${size}: apagado pegado al borde izquierdo, encendido al derecho`, () => {
      const isOff = classes(draw({ size, checked: false }));
      const on = classes(draw({ size, checked: true }));

      // El pomo se acomoda con flex desde el borde interior izquierdo. Uno
      // `absolute` dentro de un <button> sin `left` arranca del centro: es
      // exactamente el bug que se reportó.
      expect(isOff.pista).toEqual(expect.arrayContaining(["inline-flex", "items-center"]));
      expect(isOff.knob).not.toContain("absolute");

      const hint = px(isOff.pista, "w-");
      const margin = px(isOff.pista, "px-");
      const knob = px(isOff.knob, "w-");
      expect(hint).toBeGreaterThan(0);
      expect(margin).toBeGreaterThan(0);

      // Apagado: sin desplazamiento, el pomo queda a `margen` del borde.
      expect(px(isOff.knob, "translate-x-")).toBe(0);
      // Encendido: se desplaza justo lo que le sobra a la pista y queda a
      // `margen` del borde derecho. Ni un píxel afuera.
      expect(margin + knob + px(on.knob, "translate-x-") + margin).toBe(hint);

      // Y cabe a lo alto.
      expect(px(isOff.knob, "h-")).toBeLessThan(px(isOff.pista, "h-"));
    });
  }
});

describe("interruptor: accesible", () => {
  it("es un switch con nombre y estado, y no envía formularios", () => {
    const html = draw({ checked: true, label: "Agente encendido" });
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('aria-label="Agente encendido"');
    expect(html).toContain('type="button"');
    expect(draw({ checked: false })).toContain('aria-checked="false"');
  });

  it("deshabilitado se ve atenuado y no se puede operar", () => {
    const { pista: hint } = classes(draw({ disabled: true }));
    expect(draw({ disabled: true })).toMatch(/<button[^>]*disabled=""/);
    expect(hint).toContain("disabled:opacity-40");
  });

  it("tiene anillo de foco visible para quien usa el teclado", () => {
    // El acento sólido, que por construcción contrasta ≥ 3:1 con el fondo en
    // los dos temas (ver resolveAccentSet), separado de la pista: encendida
    // ya es del color del acento. El suave (`ring-brand-soft`) no llega.
    const { pista: hint } = classes(draw({ checked: true }));
    expect(hint).toEqual(
      expect.arrayContaining([
        "focus-visible:ring-2",
        "focus-visible:ring-ring",
        "focus-visible:ring-offset-2",
      ])
    );
    expect(hint).not.toContain("focus-visible:ring-brand-soft");
  });
});

describe("interruptor: uno solo en todo el producto", () => {
  it("nadie más dibuja un `role=\"switch\"` a mano", () => {
    const copies = files(SRC).filter(
      (f) =>
        path.resolve(f) !== path.resolve(UNIQUE) &&
        readFileSync(f, "utf8").includes('role="switch"')
    );
    expect(copies.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it("el Agente y la IA de la conversación usan el compartido", () => {
    for (const rel of ["components/agent/agent-client.tsx", "components/inbox/contact-panel.tsx"]) {
      const code = readFileSync(path.join(SRC, rel), "utf8");
      expect(code, rel).toContain('from "@/components/ui/switch"');
      expect(code, rel).toMatch(/<Switch\b/);
    }
  });
});
