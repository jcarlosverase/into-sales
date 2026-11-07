import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { isSupervisor } from "@/lib/auth/roles";
import { RESOURCE_KINDS, RESOURCE_NAME_MAX } from "@/lib/agenda-resources";
import { agendaDisabledResponse, agendaEnabled } from "@/server/agenda/flag";
import { resourceErrorResponse } from "@/server/agenda/http";
import { updateResource } from "@/server/agenda/resources";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  kind: z.enum(RESOURCE_KINDS).optional(),
  name: z.string().min(1).max(RESOURCE_NAME_MAX).optional(),
  weeklyHours: z.record(z.string(), z.unknown()).optional(),
  position: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
});

/** 1029 — Editar, ordenar o archivar. No hay borrado. */
export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  if (!agendaEnabled()) return agendaDisabledResponse();
  if (!isSupervisor(session.role)) {
    return apiError(403, "forbidden", "Solo dueños y administradores");
  }
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;
  try {
    const resource = await updateResource(session.organizationId, id, body.data);
    return Response.json({ resource });
  } catch (err) {
    return resourceErrorResponse(err);
  }
});
