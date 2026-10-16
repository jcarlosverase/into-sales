import { decodeText, parseCsv } from "./csv";
import { parseXlsx, XlsxError } from "./xlsx";

/** 030, D1 — Límites del archivo. */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 2000;

export class ImportFileError extends Error {}

/** El archivo como tabla de texto: encabezados y filas (sin la de encabezados). */
export function readTable(bytes: Uint8Array, fileName: string): { headers: string[]; rows: string[][] } {
  if (bytes.byteLength > MAX_IMPORT_BYTES) throw new ImportFileError("El archivo pasa de 2 MB");
  const ext = fileName.toLowerCase().split(".").pop();
  let table: string[][];
  if (ext === "xlsx") {
    try {
      table = parseXlsx(bytes);
    } catch (error) {
      throw new ImportFileError(error instanceof XlsxError ? error.message : "No se pudo leer el archivo .xlsx");
    }
  } else if (ext === "csv" || ext === "txt") {
    table = parseCsv(decodeText(bytes));
  } else {
    throw new ImportFileError("Sube un archivo .xlsx o .csv (en Excel: Guardar como → CSV o Libro de Excel)");
  }
  if (table.length === 0) throw new ImportFileError("El archivo está vacío");
  const [headers, ...rows] = table;
  if (rows.length > MAX_IMPORT_ROWS) throw new ImportFileError(`El archivo tiene ${rows.length} filas; el máximo es ${MAX_IMPORT_ROWS}`);
  return { headers: headers!, rows };
}
