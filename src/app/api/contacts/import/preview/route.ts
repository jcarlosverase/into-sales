import { apiError, withAuth } from "@/lib/api";
import { countryCodeFor } from "@/lib/import/rules";
import { ImportFileError } from "@/lib/import/table";
import { getBranding } from "@/server/branding";
import { previewImport } from "@/server/contacts-import";
import { readImportForm } from "../form";

export const dynamic = "force-dynamic";

/** 030 — Vista previa: qué columnas, qué filas entran y por qué no las demás. No guarda nada. */
export const POST = withAuth(async (session, req: Request) => {
  const parsed = await readImportForm(req);
  if (!parsed.ok) return parsed.response;
  const { form } = parsed;
  // D3 — Sin código elegido todavía, se sugiere el de la moneda del negocio.
  const countryCode = form.countryCode || countryCodeFor((await getBranding(session.organizationId)).currency);
  try {
    const preview = await previewImport({ organizationId: session.organizationId, ...form, countryCode });
    return Response.json({ ...preview, countryCode });
  } catch (error) {
    if (error instanceof ImportFileError) return apiError(422, "invalid_file", error.message);
    throw error;
  }
});
