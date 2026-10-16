import { describe, expect, it } from "vitest";
import {
  HEADER_SLOTS,
  findOffered,
  slotsMapForModel,
} from "@/server/agenda/offers";

/**
 * 015 / issue #50 — Los huecos que el modelo puede usar de verdad.
 *
 * `book_slot` exige el `startUtc` y `findOffered` compara por epoch exacto,
 * sin tolerancia. Al modelo solo le llegaban el prompt y el historial de
 * TEXTO, donde están las etiquetas que leyó el cliente —«lun 7 sep, 11:00»—
 * sin año, sin zona y sin la fecha de hoy. Acertar el instante era cuestión de
 * suerte, el rechazo caía siempre en `slot_not_offered`, y la conversación se
 * quedaba en bucle repitiendo la misma lista.
 */

const OFFERS = [
  { startUtc: "2026-09-07T15:00:00.000Z", label: "lun 7 sep, 09:00" },
  { startUtc: "2026-09-07T17:00:00.000Z", label: "lun 7 sep, 11:00" },
];

describe("slotsMapForModel", () => {
  it("empareja cada etiqueta con su instante exacto", () => {
    const map = slotsMapForModel(OFFERS)!;
    expect(map).toContain('- "lun 7 sep, 09:00" → 2026-09-07T15:00:00.000Z');
    expect(map).toContain('- "lun 7 sep, 11:00" → 2026-09-07T17:00:00.000Z');
  });

  it("lleva la cabecera que dice qué hacer con esos valores", () => {
    expect(slotsMapForModel(OFFERS)).toContain(HEADER_SLOTS);
  });

  /**
   * Sin esto, el modelo podría inventarse una reserva antes de haber ofrecido
   * nada — y el motor la rechazaría, volviendo al bucle por otro camino.
   */
  it("sin oferta vigente no hay bloque: hay que ofrecer antes de reservar", () => {
    expect(slotsMapForModel([])).toBeNull();
  });

  /**
   * La invariante que cierra el círculo: lo que el mapa enseña tiene que ser
   * exactamente lo que `findOffered` acepta. Si el formato del ISO cambiara en
   * un lado y no en el otro, volveríamos al mismo bucle sin que nada avisara.
   */
  it("todo instante del mapa es aceptado por findOffered", () => {
    const map = slotsMapForModel(OFFERS)!;
    const instants = map.match(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g) ?? [];
    expect(instants).toHaveLength(OFFERS.length);
    for (const iso of instants) {
      expect(findOffered(OFFERS, iso)).not.toBeNull();
    }
  });

  it("una etiqueta con comillas no rompe el formato de la línea", () => {
    const map = slotsMapForModel([
      { startUtc: "2026-09-07T15:00:00.000Z", label: 'mar 8 "temprano"' },
    ])!;
    expect(map.split("\n")).toHaveLength(2);
    expect(map).toContain("→ 2026-09-07T15:00:00.000Z");
  });
});
