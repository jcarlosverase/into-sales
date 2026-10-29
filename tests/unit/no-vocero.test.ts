import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Spec 1013: el nombre «Vocero» no vuelve a entrar en `src/`. Solo se admiten
 * los créditos y referencias de origen que exige o justifica la licencia MIT,
 * y los nombres viejos que se leen para migrar (cookie del tema, claves del
 * navegador, la base de antes en el doctor).
 */

const ROOT = path.join(process.cwd(), "src");

/** Lo que puede decir «vocero» sin ser el nombre del producto actual. */
const ALLOWED = [
  /Vocero Cloud/, // referencia de origen: «puerto de … de Vocero Cloud»
  /Vocero CRM/, // créditos MIT («Acerca de», globals.css)
  /kevinrivm\/vocero-crm/, // enlace al proyecto original
  /vocerocrm\.com/, // origen del estilo de los botones
  /LEGACY_THEME_COOKIE = "vocero-theme"/, // migración de la cookie
  /"vocero\.panelOpen"/, // migración de la clave del navegador
  /replace\(\/\^intosales:\/, "vocero:"\)/, // migración de las claves de citas
  /se llama vocero: renómbrala/, // doctor: la base de antes de 2026-10-17
  /de Vocero$/, // «Puerto de … de Vocero» + «Cloud» en la línea siguiente
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(ts|tsx|css)$/.test(name) ? [full] : [];
  });
}

describe("sin «Vocero» en el código", () => {
  it("ninguna línea de src/ nombra a Vocero fuera de las excepciones", () => {
    const offending = files(ROOT).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .map((line, i) => ({ line: line.trimEnd(), at: `${path.relative(process.cwd(), file)}:${i + 1}` }))
        .filter(({ line }) => /vocero/i.test(line) && !ALLOWED.some((re) => re.test(line)))
        .map(({ line, at }) => `${at}  ${line.trim()}`)
    );
    expect(offending).toEqual([]);
  });
});
