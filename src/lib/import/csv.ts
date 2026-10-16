/**
 * 030 — Lee un CSV como lo guarda Excel: separado por coma o por punto y coma
 * (Excel en español), con comillas dobles (y "" dentro), saltos de línea
 * dentro de comillas y, a veces, un BOM al inicio. Sin dependencias.
 */

/** UTF-8 si es válido; si no, Latin-1 (lo que guarda Excel en Windows). */
export function decodeText(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("latin1").decode(bytes);
  }
  return text.replace(/^﻿/, "");
}

/** El separador de la primera línea con contenido: `;` si hay más que `,`. */
export function detectSeparator(text: string): "," | ";" {
  const first = text.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  const count = (ch: string) => first.split(ch).length - 1;
  return count(";") > count(",") ? ";" : ",";
}

export function parseCsv(text: string, separator: "," | ";" = detectSeparator(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === separator) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
}
