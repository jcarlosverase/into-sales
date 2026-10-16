import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { isSupervisor } from "@/lib/auth/roles";
import {
  getRoutingSettings,
  RoutingError,
  updateRoutingSettings,
  type RoutingSettings,
} from "@/server/leads/routing";

export const dynamic = "force-dynamic";

/** 026 — Lead routing settings (contract: specs/026-reparto-de-leads/contracts/api.md). */
function toResponse(settings: RoutingSettings, canEdit: boolean) {
  return Response.json({ ...settings, canEdit });
}

export const GET = withAuth(async (session) => {
  const settings = await getRoutingSettings(session.organizationId);
  return toResponse(settings, isSupervisor(session.role));
});

const putSchema = z
  .object({
    enabled: z.boolean().optional(),
    userId: z.string().min(1).optional(),
    receivesLeads: z.boolean().optional(),
  })
  .refine((b) => (b.userId === undefined) === (b.receivesLeads === undefined), {
    message: "userId y receivesLeads van juntos",
  });

export const PUT = withAuth(async (session, req: Request) => {
  if (!isSupervisor(session.role)) {
    return apiError(403, "forbidden", "Solo un supervisor puede cambiar el reparto");
  }
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;
  try {
    const settings = await updateRoutingSettings(session.organizationId, body.data);
    return toResponse(settings, true);
  } catch (err) {
    if (err instanceof RoutingError) return apiError(422, err.code, err.message);
    throw err;
  }
});
