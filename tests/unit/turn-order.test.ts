import { describe, expect, it } from "vitest";
import {
  handledByPerson,
  currentOwed,
  sortForTurn,
  remainingOwed,
} from "@/server/ai/turn-order";

/**
 * 025 — El orden en que el agente incluido lee la conversación.
 *
 * El caso que importa: el cliente escribe otra vez mientras el modelo piensa.
 * Por hora de llegada ese mensaje queda ANTES de la respuesta al anterior, y
 * el modelo, que ve un hilo terminado en su propia respuesta, lo da por
 * contestado. El turno siguiente tiene que leerlo como lo último que se dijo.
 */

let clock = 0;
const msg = (id: string, direction: "in" | "out", aiGenerated = direction === "out") => ({
  id,
  direction,
  aiGenerated,
  createdAt: new Date(Date.UTC(2026, 9, 13, 12, 0, clock++)),
});
/** Un saliente escrito por una persona desde la bandeja. */
const byHand = (id: string) => msg(id, "out", false);
const ids = (ms: { id: string }[]) => ms.map((m) => m.id);

describe("sortForTurn", () => {
  it("sin debidos no mueve nada (Laboratorio y turno normal)", () => {
    const h = [msg("m1", "in"), msg("m2", "in"), msg("r1", "out")];
    expect(ids(sortForTurn(h, []))).toEqual(["m1", "m2", "r1"]);
  });

  it("lo que entró mientras el modelo pensaba va después de su respuesta", () => {
    const m1 = msg("m1", "in");
    const m2 = msg("m2", "in"); // entra con el turno de m1 en curso
    const r1 = msg("r1", "out"); // la respuesta a m1 sale después
    expect(ids(sortForTurn([m1, m2, r1], [m2]))).toEqual(["m1", "r1", "m2"]);
  });

  it("el caso normal queda igual: lo debido ya es lo último", () => {
    const h = [msg("m0", "in"), msg("r0", "out"), msg("m1", "in")];
    expect(ids(sortForTurn(h, [h[2]!]))).toEqual(["m0", "r0", "m1"]);
  });

  it("lo debido y lo que llegó después de la respuesta se leen en su orden", () => {
    const m1 = msg("m1", "in");
    const m2 = msg("m2", "in");
    const r1 = msg("r1", "out");
    const m3 = msg("m3", "in"); // llegó después de la respuesta: nadie lo movió
    expect(ids(sortForTurn([m1, m2, r1, m3], [m2]))).toEqual([
      "m1",
      "r1",
      "m2",
      "m3",
    ]);
  });

  it("un debido que ya no cabe en la ventana del historial entra igual", () => {
    const old = msg("m_viejo", "in");
    const h = [msg("r1", "out"), msg("m9", "in")];
    expect(ids(sortForTurn(h, [old]))).toEqual(["r1", "m_viejo", "m9"]);
  });

  it("no duplica un debido que ya estaba en el historial", () => {
    const m1 = msg("m1", "in");
    const r1 = msg("r1", "out");
    expect(ids(sortForTurn([m1, r1], [m1]))).toEqual(["r1", "m1"]);
  });

  it("un saliente nunca se trata como debido", () => {
    const h = [msg("m1", "in"), msg("r1", "out")];
    expect(ids(sortForTurn(h, [h[1]!]))).toEqual(["m1", "r1"]);
  });
});

describe("debidosVigentes — lo que una persona ya contestó no se debe", () => {
  it("sin respuestas a mano, todo lo debido sigue debiéndose", () => {
    const m1 = msg("m1", "in");
    const m2 = msg("m2", "in");
    const r1 = msg("r1", "out"); // del agente: no salda m2
    expect(ids(currentOwed([m1, m2, r1], [m2]))).toEqual(["m2"]);
  });

  it("un debido anterior a la respuesta de una persona ya está atendido", () => {
    const m1 = msg("m1", "in");
    const h1 = byHand("h1");
    expect(currentOwed([m1, h1], [m1])).toEqual([]);
  });

  it("uno posterior a esa respuesta sí se debe", () => {
    const m1 = msg("m1", "in");
    const h1 = byHand("h1");
    const m2 = msg("m2", "in");
    const r2 = msg("r2", "out");
    expect(ids(currentOwed([m1, h1, m2, r2], [m1, m2]))).toEqual(["m2"]);
  });

  it("un debido fuera del historial se compara por hora con esa respuesta", () => {
    const old = msg("m_viejo", "in");
    const h1 = byHand("h1");
    const newOne = msg("m_nuevo", "in");
    expect(ids(currentOwed([h1], [old, newOne]))).toEqual(["m_nuevo"]);
  });
});

describe("handledByPerson", () => {
  it("lo último es la respuesta de una persona → sí", () => {
    expect(handledByPerson([msg("m1", "in"), byHand("h1")])).toBe(true);
  });

  it("el cliente volvió a escribir después → no", () => {
    expect(handledByPerson([msg("m1", "in"), byHand("h1"), msg("m2", "in")])).toBe(false);
  });

  it("lo último es una respuesta del agente → no: eso no salda nada", () => {
    expect(handledByPerson([msg("m1", "in"), msg("r1", "out")])).toBe(false);
  });

  it("una respuesta del agente después de la de la persona no cambia nada", () => {
    expect(handledByPerson([msg("m1", "in"), byHand("h1"), msg("r1", "out")])).toBe(true);
  });

  it("nadie ha contestado a mano → no", () => {
    expect(handledByPerson([msg("m1", "in")])).toBe(false);
    expect(handledByPerson([])).toBe(false);
  });
});

describe("quedanDebidos — ¿hace falta otro turno?", () => {
  it("lo que entró mientras el modelo pensaba y el turno no leyó se debe", () => {
    expect(remainingOwed(new Set(["m2"]), ["m1"])).toEqual(["m2"]);
  });

  it("lo que entró a tiempo de que el turno lo leyera ya está atendido", () => {
    // Entre que arranca el turno y abre el historial caben unos milisegundos.
    // Repetir el turno sería contestarle dos veces.
    expect(remainingOwed(new Set(["m2"]), ["m1", "m2"])).toEqual([]);
  });

  it("si el turno no llegó a leer, todo lo anotado se sigue debiendo", () => {
    expect(remainingOwed(new Set(["m1", "m2"]), undefined)).toEqual(["m1", "m2"]);
  });

  it("sin nada anotado no hay turno extra", () => {
    expect(remainingOwed(new Set(), ["m1"])).toEqual([]);
  });
});
