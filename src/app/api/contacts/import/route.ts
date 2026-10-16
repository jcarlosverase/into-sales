import { eq } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { isSupervisor } from "@/lib/auth/roles";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { ImportFileError } from "@/lib/import/table";
import { runImport, type ImportAssign } from "@/server/contacts-import";
import { readImportForm } from "./form";

export const dynamic = "force-dynamic";

/**
 * 030 — Importa: crea los contactos nuevos con su lead (022) y devuelve el
 * resumen. Un vendedor se queda con sus leads; un supervisor elige (D5):
 * `assign=turno` (defecto), `user:<id>` o `ninguno`.
 */
export const POST = withAuth(async (session, req: Request) => {
  const parsed = await readImportForm(req);
  if (!parsed.ok) return parsed.response;
  const { form } = parsed;

  let assign: ImportAssign;
  if (!isSupervisor(session.role)) assign = { kind: "self", userId: session.userId };
  else if (form.assign === "ninguno") assign = { kind: "none" };
  else if (form.assign.startsWith("user:")) {
    const userId = form.assign.slice(5);
    const member = await getDb()
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(scoped(schema.member.organizationId, session.organizationId, eq(schema.member.userId, userId)))
      .limit(1);
    if (!member[0]) return apiError(422, "invalid_assignee", "Ese usuario no es del equipo");
    assign = { kind: "user", userId };
  } else assign = { kind: "rotation" };

  try {
    const result = await runImport({ organizationId: session.organizationId, actorUserId: session.userId, ...form, assign });
    return Response.json(result);
  } catch (error) {
    if (error instanceof ImportFileError) return apiError(422, "invalid_file", error.message);
    throw error;
  }
});
