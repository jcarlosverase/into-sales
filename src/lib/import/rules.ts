/**
 * 030 — Reglas de la importación, puras: qué columna es qué (D2), cómo queda
 * cada teléfono (D3) y qué pasa con cada fila (D4). Las usan la vista previa,
 * la importación y las pruebas, así las tres dicen lo mismo.
 */

export type ImportField = "name" | "phone" | "notes" | "stage";
export type ImportMapping = Record<ImportField, number | null>;

const SYNONYMS: Record<ImportField, string[]> = {
  name: ["nombre", "nombres", "nombre completo", "cliente", "contacto", "name", "full name"],
  phone: ["telefono", "tel", "celular", "cel", "movil", "whatsapp", "wsp", "numero", "phone", "mobile"],
  notes: ["notas", "nota", "comentario", "comentarios", "observaciones", "observacion", "notes"],
  stage: ["etapa", "estado", "fase", "stage"],
};

export const normalizeHeader = (h: string) =>
  h.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** D2 — Cada campo a la primera columna cuyo encabezado lo nombre. */
export function guessMapping(headers: string[]): ImportMapping {
  const normalized = headers.map(normalizeHeader);
  const pick = (field: ImportField) => {
    const exact = normalized.findIndex((h) => SYNONYMS[field].includes(h));
    if (exact >= 0) return exact;
    const partial = normalized.findIndex((h) => SYNONYMS[field].some((s) => h.split(" ").includes(s)));
    return partial >= 0 ? partial : null;
  };
  return { name: pick("name"), phone: pick("phone"), notes: pick("notes"), stage: pick("stage") };
}

/** D3 — El código de país sugerido según la moneda del negocio. */
export function countryCodeFor(currency: string | null | undefined): string {
  const codes: Record<string, string> = { PEN: "51", MXN: "52", COP: "57", CLP: "56", ARS: "54", USD: "1" };
  return codes[(currency ?? "").toUpperCase()] ?? "";
}

/**
 * D3 — Solo dígitos, sin `+` ni `00`; un número de 10 dígitos o menos es local
 * y recibe el código de país; `521…` → `52…` como en el alta manual; 7 a 15
 * dígitos o nada. Un número que Excel guardó en notación científica no sirve.
 */
export function normalizeImportPhone(raw: string, countryCode: string): string | null {
  if (/e\+?\d/i.test(raw)) return null;
  let digits = raw.trim().replace(/\.0+$/, "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 0) return null;
  if (digits.length <= 10) {
    const code = countryCode.replace(/\D/g, "");
    if (!code) return null;
    digits = code + digits;
  }
  if (/^521\d{10}$/.test(digits)) digits = `52${digits.slice(3)}`;
  return /^\d{7,15}$/.test(digits) ? digits : null;
}

export type RowStatus = "ok" | "exists" | "duplicate" | "invalid_phone";

export type PlannedRow = {
  /** Fila en el archivo, contando el encabezado como la 1 (como la ve Excel). */
  row: number;
  name: string;
  phone: string | null;
  rawPhone: string;
  notes: string | null;
  stage: string | null;
  status: RowStatus;
};

export type ImportPlan = {
  rows: PlannedRow[];
  counts: Record<RowStatus, number>;
};

/** D4 — Qué pasa con cada fila. `existing` son los teléfonos que ya son contactos. */
export function planImport(
  rows: string[][],
  mapping: ImportMapping,
  options: { countryCode: string },
  existing: ReadonlySet<string>
): ImportPlan {
  const seen = new Set<string>();
  const cell = (r: string[], i: number | null) => (i === null ? "" : (r[i] ?? "").trim());
  const planned: PlannedRow[] = rows.map((r, i) => {
    const rawPhone = cell(r, mapping.phone);
    const phone = normalizeImportPhone(rawPhone, options.countryCode);
    const name = (cell(r, mapping.name) || phone || rawPhone).slice(0, 120);
    const status: RowStatus = !phone ? "invalid_phone" : existing.has(phone) ? "exists" : seen.has(phone) ? "duplicate" : "ok";
    if (phone) seen.add(phone);
    return {
      row: i + 2,
      name,
      phone,
      rawPhone,
      notes: cell(r, mapping.notes).slice(0, 4000) || null,
      stage: cell(r, mapping.stage) || null,
      status,
    };
  });
  const counts: Record<RowStatus, number> = { ok: 0, exists: 0, duplicate: 0, invalid_phone: 0 };
  for (const p of planned) counts[p.status]++;
  return { rows: planned, counts };
}
