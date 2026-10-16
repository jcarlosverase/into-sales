import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeText, detectSeparator, parseCsv } from "@/lib/import/csv";
import { countryCodeFor, guessMapping, normalizeImportPhone, planImport } from "@/lib/import/rules";
import { ImportFileError, MAX_IMPORT_ROWS, readTable } from "@/lib/import/table";
import { parseXlsx } from "@/lib/import/xlsx";

const enc = (s: string) => new TextEncoder().encode(s);

describe("030 — CSV como lo guarda Excel (D1)", () => {
  it("detecta coma o punto y coma y respeta comillas", () => {
    expect(detectSeparator("Nombre;Teléfono\nAna;987")).toBe(";");
    expect(detectSeparator("Nombre,Teléfono\nAna,987")).toBe(",");
    expect(parseCsv('Nombre;Notas\n"Pérez; Ana";"dijo ""sí""\notra línea"\n\nLuis;x', ";")).toEqual([
      ["Nombre", "Notas"],
      ["Pérez; Ana", 'dijo "sí"\notra línea'],
      ["Luis", "x"],
    ]);
  });

  it("lee UTF-8 con BOM y Latin-1", () => {
    expect(decodeText(enc("﻿Nombre\nNúñez"))).toBe("Nombre\nNúñez");
    const latin1 = Uint8Array.from([0x4e, 0xfa, 0xf1, 0x65, 0x7a]); // «Núñez» en Latin-1
    expect(decodeText(latin1)).toBe("Núñez");
  });
});

describe("030 — .xlsx sin dependencias (D1)", () => {
  it("lee la primera hoja con cadenas compartidas, en línea, texto enriquecido y números", () => {
    const rows = parseXlsx(readFileSync("tests/fixtures/contacts.xlsx"));
    expect(rows).toEqual([
      ["Nombre", "Celular", "Observaciones"],
      ["María José Ñahui", "51987654321", "Pide precio & horario"],
      ["Luis", "987 111 222"],
      ["", "+52 1 55 1234 5678", "sin nombre"],
    ]);
  });

  it("rechaza lo que no es .xlsx ni .csv, lo vacío y lo enorme (AC1)", () => {
    expect(() => readTable(enc("hola"), "lista.xls")).toThrow(ImportFileError);
    expect(() => readTable(enc("no es un zip"), "lista.xlsx")).toThrow(/no es un archivo \.xlsx válido/i);
    expect(() => readTable(enc(""), "vacio.csv")).toThrow(/vacío/);
    const big = "Nombre,Telefono\n" + Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `N${i},51900${i}`).join("\n");
    expect(() => readTable(enc(big), "grande.csv")).toThrow(/máximo es 2000/);
  });
});

describe("030 — columnas y teléfonos (D2, D3)", () => {
  it("adivina las columnas por el encabezado, sin tildes ni mayúsculas", () => {
    expect(guessMapping(["N°", "Nombre del cliente", "Teléfono", "OBSERVACIONES", "Estado"])).toEqual({ name: 1, phone: 2, notes: 3, stage: 4 });
    expect(guessMapping(["WhatsApp", "Cliente"])).toEqual({ name: 1, phone: 0, notes: null, stage: null });
  });

  it("antepone el código de país a los locales y valida 7–15 dígitos (AC3)", () => {
    expect(normalizeImportPhone("987 654 321", "51")).toBe("51987654321");
    expect(normalizeImportPhone("+51 987-654-321", "")).toBe("51987654321");
    expect(normalizeImportPhone("0051987654321", "")).toBe("51987654321");
    expect(normalizeImportPhone("+52 1 55 1234 5678", "51")).toBe("525512345678");
    expect(normalizeImportPhone("(55) 1234-5678", "52")).toBe("525512345678");
    expect(normalizeImportPhone("987654321", "")).toBeNull();
    expect(normalizeImportPhone("5.19876E+10", "51")).toBeNull();
    expect(normalizeImportPhone("51987654321.0", "")).toBe("51987654321");
    expect(normalizeImportPhone("", "51")).toBeNull();
    expect(normalizeImportPhone("1234567890123456", "51")).toBeNull();
  });

  it("sugiere el código de país por la moneda del negocio", () => {
    expect(countryCodeFor("PEN")).toBe("51");
    expect(countryCodeFor("mxn")).toBe("52");
    expect(countryCodeFor("EUR")).toBe("");
  });
});

describe("030 — qué pasa con cada fila (D4)", () => {
  it("marca existentes, repetidos e inválidos, y usa el teléfono como nombre si falta", () => {
    const rows = [
      ["Ana", "987654321", "vino a la feria"],
      ["Beto", "51987000111", ""],
      ["Ana otra vez", "+51 987 654 321", ""],
      ["", "51911222333", ""],
      ["Malo", "12", ""],
    ];
    const plan = planImport(rows, { name: 0, phone: 1, notes: 2, stage: null }, { countryCode: "51" }, new Set(["51987000111"]));
    expect(plan.rows.map((r) => [r.row, r.name, r.phone, r.status])).toEqual([
      [2, "Ana", "51987654321", "ok"],
      [3, "Beto", "51987000111", "exists"],
      [4, "Ana otra vez", "51987654321", "duplicate"],
      [5, "51911222333", "51911222333", "ok"],
      [6, "Malo", null, "invalid_phone"],
    ]);
    expect(plan.counts).toEqual({ ok: 2, exists: 1, duplicate: 1, invalid_phone: 1 });
    expect(plan.rows[0]!.notes).toBe("vino a la feria");
  });
});
