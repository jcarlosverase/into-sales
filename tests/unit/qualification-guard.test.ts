import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guardarraíl de la ficha del lead.
 *
 * La ficha es información de calificación de los clientes de alguien: qué
 * presupuesto tiene, qué le duele, si decide él. Se escribe desde dos lados
 * —el cerebro externo por `PUT /api/bot/ficha` y el dueño desde la bandeja— y
 * las dos rutas entran por `upsertQualification`.
 *
 * Aquí se verifica que esa puerta filtre por organización POR SÍ MISMA, y no
 * confiando en que el llamador se acuerde. Ese "acuérdate de filtrar" es
 * exactamente como se filtran datos entre inquilinos: nada truena, y el
 * incidente se descubre cuando ya salió.
 *
 * Si estás leyendo esto porque el test se puso rojo: no lo relajes.
 */

const SRC = path.resolve(import.meta.dirname, "..", "..", "src");
const GATE = path.join(SRC, "server", "bot", "qualification.ts");

function filesTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...filesTs(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("guardarraíl: la ficha nunca se escribe sin organización", () => {
  const gate = readFileSync(GATE, "utf8");

  it("`upsertQualification` recibe la organización", () => {
    const signature = gate.slice(gate.indexOf("export async function upsertQualification"));
    expect(signature.slice(0, 200)).toContain("organizationId");
  });

  it("y la usa: sus queries pasan por `scoped`, no por un `eq` pelón", () => {
    const body = gate.slice(
      gate.indexOf("export async function upsertQualification")
    );
    expect(body).toContain("scoped(");
    expect(body).toContain("schema.contact.organizationId");
  });

  it("nadie más escribe `contact.ficha` por su cuenta", () => {
    const culpables: string[] = [];
    for (const file of filesTs(SRC)) {
      if (path.resolve(file) === path.resolve(GATE)) continue;
      const code = readFileSync(file, "utf8");
      // `.set({ … ficha … })` sobre la tabla de contactos, fuera de la puerta.
      const re = /\.update\(\s*schema\.contact\s*\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(code)) !== null) {
        const block = code.slice(m.index, m.index + 400);
        if (/\bficha\b/.test(block)) {
          culpables.push(path.relative(SRC, file));
        }
      }
    }
    expect(culpables).toEqual([]);
  });
});
