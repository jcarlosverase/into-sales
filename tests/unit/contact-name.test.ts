import { describe, expect, it } from "vitest";

/**
 * 003 / #51 — Cuándo se actualiza el nombre de un contacto.
 *
 * Se ponía SOLO al crearlo, así que quien cambiaba su nombre de WhatsApp
 * seguía apareciendo con el viejo para siempre (reportado por @federicorv25:
 * cambió de «Federico» a «Federicoso» y el CRM no se enteró).
 *
 * Pero actualizarlo siempre rompería otra cosa: el operador que renombró a
 * alguien como «Juan - obra Polanco» perdería ese trabajo con el siguiente
 * mensaje. De ahí `nameSource`.
 *
 * La decisión se prueba como TABLA y sin base de datos: es una regla de
 * negocio, y enterrarla en un test de integración la haría invisible.
 */

/** La regla, tal cual la aplica `getOrCreateContactByIdentity`. */
function newName(
  actual: { name: string; nameSource: "perfil" | "manual" },
  profile: string | null
): string | null {
  const fromProfile = profile?.trim();
  if (!fromProfile) return null;
  if (actual.nameSource !== "perfil") return null;
  if (fromProfile === actual.name) return null;
  return fromProfile;
}

describe("el nombre que trae WhatsApp", () => {
  it("actualiza un nombre que vino del perfil (el caso reportado)", () => {
    expect(
      newName({ name: "Federico", nameSource: "perfil" }, "Federicoso")
    ).toBe("Federicoso");
  });

  it("NO toca un nombre que escribió una persona", () => {
    expect(
      newName(
        { name: "Juan - obra Polanco", nameSource: "manual" },
        "Juan"
      )
    ).toBeNull();
  });

  it("sin nombre de perfil no hay nada que hacer", () => {
    expect(newName({ name: "Federico", nameSource: "perfil" }, null)).toBeNull();
    expect(newName({ name: "Federico", nameSource: "perfil" }, "   ")).toBeNull();
  });

  /**
   * Sin esto, cada mensaje escribiría el mismo nombre otra vez y movería
   * `updated_at`: ruido en la base y en cualquier cosa que ordene por él.
   */
  it("el mismo nombre no genera escritura", () => {
    expect(
      newName({ name: "Federico", nameSource: "perfil" }, "Federico")
    ).toBeNull();
  });

  it("recorta los espacios que manda WhatsApp", () => {
    expect(
      newName({ name: "Federico", nameSource: "perfil" }, "  Federicoso  ")
    ).toBe("Federicoso");
  });
});
