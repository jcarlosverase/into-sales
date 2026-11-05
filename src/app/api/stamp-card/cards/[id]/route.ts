import { apiError, withAuth } from "@/lib/api";
import { getCard } from "@/server/stamp-card/cards";
import { stampCardDisabledResponse, stampCardEnabled } from "@/server/stamp-card/flag";
import { cardView } from "@/server/stamp-card/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** 1023 — Una tarjeta con su bitácora (AC14). Cualquiera del equipo puede sellar (D6). */
export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  if (!stampCardEnabled()) return stampCardDisabledResponse();
  const { id } = await ctx.params;
  const card = await getCard(session.organizationId, id);
  if (!card) return apiError(404, "not_found", "Tarjeta no encontrada");
  return Response.json({ card: await cardView(session.organizationId, card, { withEvents: true }) });
});
