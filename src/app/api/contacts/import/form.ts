import { z } from "zod";
import { apiError } from "@/lib/api";
import type { ImportMapping } from "@/lib/import/rules";
import { MAX_IMPORT_BYTES } from "@/lib/import/table";

/** 030 — Lo que mandan el diálogo y el guion: el archivo y las opciones. */
const mappingSchema = z.object({
  name: z.number().int().min(0).nullable(),
  phone: z.number().int().min(0).nullable(),
  notes: z.number().int().min(0).nullable(),
  stage: z.number().int().min(0).nullable(),
});

export type ImportForm = {
  bytes: Uint8Array;
  fileName: string;
  mapping: ImportMapping | null;
  countryCode: string;
  assign: string;
};

export async function readImportForm(req: Request): Promise<{ ok: true; form: ImportForm } | { ok: false; response: Response }> {
  let data: FormData;
  try {
    data = await req.formData();
  } catch {
    return { ok: false, response: apiError(422, "invalid_body", "Manda el archivo como multipart/form-data") };
  }
  const file = data.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, response: apiError(422, "invalid_file", "Elige un archivo .xlsx o .csv") };
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return { ok: false, response: apiError(413, "file_too_large", "El archivo pasa de 2 MB") };
  }
  let mapping: ImportMapping | null = null;
  const rawMapping = data.get("mapping");
  if (typeof rawMapping === "string" && rawMapping) {
    let json: unknown = null;
    try {
      json = JSON.parse(rawMapping);
    } catch {
      // Cae al 422 de abajo.
    }
    const parsed = mappingSchema.safeParse(json);
    if (!parsed.success || parsed.data.phone === null) {
      return { ok: false, response: apiError(422, "invalid_mapping", "Elige qué columna es el teléfono") };
    }
    mapping = parsed.data;
  }
  const countryCode = String(data.get("countryCode") ?? "").replace(/\D/g, "").slice(0, 4);
  return {
    ok: true,
    form: {
      bytes: new Uint8Array(await file.arrayBuffer()),
      fileName: file.name,
      mapping,
      countryCode,
      assign: String(data.get("assign") ?? "turno"),
    },
  };
}
