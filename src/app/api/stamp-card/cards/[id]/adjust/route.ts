import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { adjustStamps } from "@/server/stamp-card/cards";
import { stampCardDisabledResponse, stampCardEnabled } from "@/server/stamp-card/flag";
import { cardView, idempotencyKeyOf, stampCardErrorResponse } from "@/server/stamp-card/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z
  .object({ delta: z.number().int().min(-30).max(30).refine((d) => d !== 0, "El ajuste no puede ser 0") })
  .strict();

/** D7 — Ajuste manual de sellos: solo un administrador, y queda en la bitácora. */
export const POST = withAuth(async (session, req: Request, ctx: Params) => {
  if (!stampCardEnabled()) return stampCardDisabledResponse();
  if (!canConfigure(session.role)) {
    return apiError(403, "forbidden", "Solo quien administra el negocio puede ajustar sellos");
  }
  const key = idempotencyKeyOf(req);
  if (!key.ok) return key.response;
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  const { id } = await ctx.params;
  try {
    const result = await adjustStamps(session.organizationId, id, body.data.delta, {
      userId: session.userId,
      source: "panel",
      idempotencyKey: key.key,
    });
    return Response.json({ card: await cardView(session.organizationId, result.card, { withEvents: true }) });
  } catch (err) {
    return stampCardErrorResponse(err);
  }
});
