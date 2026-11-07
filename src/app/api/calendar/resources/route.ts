import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { isSupervisor } from "@/lib/auth/roles";
import { RESOURCE_KINDS, RESOURCE_NAME_MAX } from "@/lib/agenda-resources";
import { agendaDisabledResponse, agendaEnabled } from "@/server/agenda/flag";
import { resourceErrorResponse } from "@/server/agenda/http";
import { createResource, listResources } from "@/server/agenda/resources";
import { getSettings } from "@/server/agenda/settings";

export const dynamic = "force-dynamic";

/** 1029 — Los profesionales o recursos, y cómo decide el agente con ellos. */
export const GET = withAuth(async (session, req: Request) => {
  if (!agendaEnabled()) return agendaDisabledResponse();
  const includeArchived = new URL(req.url).searchParams.get("includeArchived") === "true";
  const [resources, settings] = await Promise.all([
    listResources(session.organizationId, { includeArchived }),
    getSettings(session.organizationId),
  ]);
  return Response.json({
    resources,
    agentResourceMode: settings.agentResourceMode,
    canManage: isSupervisor(session.role),
  });
});

const postSchema = z.object({
  kind: z.enum(RESOURCE_KINDS).default("person"),
  name: z.string().min(1).max(RESOURCE_NAME_MAX),
  weeklyHours: z.record(z.string(), z.unknown()).optional(),
});

/** Sin `weeklyHours`, copia el horario del negocio. */
export const POST = withAuth(async (session, req: Request) => {
  if (!agendaEnabled()) return agendaDisabledResponse();
  if (!isSupervisor(session.role)) {
    return apiError(403, "forbidden", "Solo dueños y administradores");
  }
  const body = await parseBody(req, postSchema);
  if (!body.ok) return body.response;
  try {
    const result = await createResource(session.organizationId, {
      ...body.data,
      kind: body.data.kind ?? "person",
    });
    return Response.json(result, { status: 201 });
  } catch (err) {
    return resourceErrorResponse(err);
  }
});
