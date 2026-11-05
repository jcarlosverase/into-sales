import { withAuth } from "@/lib/api";
import { redeemReward } from "@/server/stamp-card/cards";
import { stampCardDisabledResponse, stampCardEnabled } from "@/server/stamp-card/flag";
import { cardView, idempotencyKeyOf, stampCardErrorResponse } from "@/server/stamp-card/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** AC6 — Canjea el premio. Sin la tarjeta completa, 409 `not_complete`. */
export const POST = withAuth(async (session, req: Request, ctx: Params) => {
  if (!stampCardEnabled()) return stampCardDisabledResponse();
  const key = idempotencyKeyOf(req);
  if (!key.ok) return key.response;
  const { id } = await ctx.params;
  try {
    const result = await redeemReward(session.organizationId, id, {
      userId: session.userId,
      source: new URL(req.url).searchParams.get("source") === "qr" ? "qr" : "panel",
      idempotencyKey: key.key,
    });
    return Response.json({ card: await cardView(session.organizationId, result.card, { withEvents: true }) });
  } catch (err) {
    return stampCardErrorResponse(err);
  }
});
