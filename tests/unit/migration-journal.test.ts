import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * El journal de drizzle es lo que decide qué migración corre en cada base.
 * El migrador solo aplica las que tienen un `when` mayor que la última
 * aplicada, así que una fecha fuera de orden se salta EN SILENCIO en toda
 * base existente; y una entrada sin su `.sql` tumba el arranque del
 * contenedor. Pasó con `0017_lead_assignment` (renombrada a 0019): spec 028.
 */
const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
  entries: { idx: number; when: number; tag: string }[];
};

describe("drizzle/meta/_journal.json", () => {
  it("cada entrada tiene su archivo .sql", () => {
    for (const { tag } of journal.entries) expect(existsSync(`drizzle/${tag}.sql`), tag).toBe(true);
  });

  it("los idx van 0, 1, 2… sin repetirse", () => {
    expect(journal.entries.map((e) => e.idx)).toEqual(journal.entries.map((_, i) => i));
  });

  it("las fechas (`when`) siempre crecen", () => {
    const whens = journal.entries.map((e) => e.when);
    for (let i = 1; i < whens.length; i++) expect(whens[i], journal.entries[i]!.tag).toBeGreaterThan(whens[i - 1]!);
  });

  it("el número del archivo es su posición", () => {
    for (const { idx, tag } of journal.entries) expect(tag.slice(0, 4), tag).toBe(String(idx).padStart(4, "0"));
  });
});
