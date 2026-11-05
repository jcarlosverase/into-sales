import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { programInputSchema } from "@/lib/stamp-card";
import { stampCardDisabledResponse, stampCardEnabled } from "@/server/stamp-card/flag";
import { approvedTemplate, getProgram, programDefaults, saveProgram } from "@/server/stamp-card/program";

export const dynamic = "force-dynamic";

/** 1023 — El programa de la tarjeta de sellos, o los valores propuestos si aún no hay. */
export const GET = withAuth(async (session) => {
  if (!stampCardEnabled()) return stampCardDisabledResponse();
  const [program, defaults] = await Promise.all([
    getProgram(session.organizationId),
    programDefaults(session.organizationId),
  ]);
  return Response.json({ program, defaults });
});

/** AC2 — Solo quien configura el negocio lo cambia; algo inválido responde 422. */
export const PUT = withAuth(async (session, req: Request) => {
  if (!stampCardEnabled()) return stampCardDisabledResponse();
  if (!canConfigure(session.role)) {
    return apiError(403, "forbidden", "Solo quien administra el negocio configura la tarjeta de sellos");
  }
  const body = await parseBody(req, programInputSchema);
  if (!body.ok) return body.response;
  if (body.data.completeTemplateId && !(await approvedTemplate(session.organizationId, body.data.completeTemplateId))) {
    return apiError(422, "invalid_template", "La plantilla del aviso tiene que ser una plantilla aprobada de este negocio");
  }
  const program = await saveProgram(session.organizationId, { ...body.data, terms: body.data.terms ?? null });
  return Response.json({ program });
});
