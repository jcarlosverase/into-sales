import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { addStamp } from "@/server/stamp-card/cards";
import { stampCardDisabledResponse, stampCardEnabled } from "@/server/stamp-card/flag";
import { cardView, idempotencyKeyOf, stampCardErrorResponse } from "@/server/stamp-card/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z
  .object({ force: z.boolean().optional(), source: z.enum(["panel", "qr"]).optional() })
  .strict();

/**
 * AC5 — Suma un sello. Con la misma Idempotency-Key no suma dos. Antes del
 * mínimo de horas responde 409 `needs_confirmation` con `nextAt`; se repite
 * con `force: true` para confirmar (D7).
 */
export const POST = withAuth(async (session, req: Request, ctx: Params) => {
  if (!stampCardEnabled()) return stampCardDisabledResponse();
  const key = idempotencyKeyOf(req);
  if (!key.ok) return key.response;
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  const { id } = await ctx.params;
  try {
    const result = await addStamp(session.organizationId, id, {
      userId: session.userId,
      source: body.data.source ?? "panel",
      idempotencyKey: key.key,
      force: body.data.force,
    });
    if (result.status === "needs_confirmation") {
      return Response.json(
        {
          error: { code: "needs_confirmation", message: "Ya se sumó un sello hace poco. ¿Sumar otro igual?" },
          nextAt: result.nextAt.toISOString(),
        },
        { status: 409 }
      );
    }
    return Response.json({
      card: await cardView(session.organizationId, result.card, { withEvents: true }),
      completed: result.completed,
    });
  } catch (err) {
    return stampCardErrorResponse(err);
  }
});
