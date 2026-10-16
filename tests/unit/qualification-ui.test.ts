import { describe, expect, it } from "vitest";
import {
  qualificationEntries,
  qualificationLabel,
  qualificationValueText,
  parseQualificationValue,
} from "@/lib/qualification";

describe("qualificationLabel", () => {
  it("lee bonito lo que escribió un LLM, en cualquiera de sus manías", () => {
    expect(qualificationLabel("dolor_principal")).toBe("Dolor principal");
    expect(qualificationLabel("dolorPrincipal")).toBe("Dolor principal");
    expect(qualificationLabel("dolor-principal")).toBe("Dolor principal");
    expect(qualificationLabel("presupuesto")).toBe("Presupuesto");
  });

  it("no se rompe con claves raras", () => {
    expect(qualificationLabel("m2")).toBe("M2");
    expect(qualificationLabel("__")).toBe("__");
    expect(qualificationLabel("ZONA")).toBe("Zona");
  });
});

describe("qualificationValueText", () => {
  it("los booleanos se leen Sí/No: nadie califica en true", () => {
    expect(qualificationValueText(true)).toBe("Sí");
    expect(qualificationValueText(false)).toBe("No");
  });

  it("números y textos pasan tal cual", () => {
    expect(qualificationValueText(50000)).toBe("50000");
    expect(qualificationValueText("Polanco")).toBe("Polanco");
  });
});

describe("parseQualificationValue", () => {
  it("editar NO cambia el tipo del dato", () => {
    // Del otro lado hay un bot que puede estar comparando; convertir en
    // silencio un número a texto es de los cambios que solo se descubren
    // cuando algo ya falló.
    expect(parseQualificationValue("60000", 50000)).toBe(60000);
    expect(parseQualificationValue("No", true)).toBe(false);
    expect(parseQualificationValue("sí", false)).toBe(true);
    expect(parseQualificationValue("Polanco", "Roma")).toBe("Polanco");
  });

  it("pero sí lo cambia si lo escrito ya no es de ese tipo", () => {
    expect(parseQualificationValue("como cinco mil", 5000)).toBe("como cinco mil");
    expect(parseQualificationValue("depende", true)).toBe("depende");
  });

  it("un dato nuevo entra como texto", () => {
    expect(parseQualificationValue("42", undefined)).toBe("42");
  });

  it("recorta los espacios de sobra", () => {
    expect(parseQualificationValue("  Polanco  ", "Roma")).toBe("Polanco");
  });
});

describe("qualificationEntries", () => {
  it("ordena para que la ficha no baile entre recargas", () => {
    const keys = qualificationEntries({ zona: "Roma", dolor: "x", presupuesto: 1 }).map(
      ([k]) => k
    );
    expect(keys).toEqual(["dolor", "presupuesto", "zona"]);
  });

  it("una ficha vacía no truena", () => {
    expect(qualificationEntries({})).toEqual([]);
  });
});
