import { apiError, withAuth } from "@/lib/api";
import { PeriodError, periodFromRequest } from "@/server/analytics/period";
import { stampCardBlock } from "@/server/analytics/stamp-card";
import { stampCardDisabledResponse, stampCardEnabled } from "@/server/stamp-card/flag";

export const dynamic = "force-dynamic";

/** 1023, AC12 — La tarjeta de sellos del periodo (`?from=AAAA-MM-DD&to=AAAA-MM-DD`). Sin la bandera, 404. */
export const GET = withAuth(async (session, req: Request) => {
  if (!stampCardEnabled()) return stampCardDisabledResponse();
  try {
    const period = await periodFromRequest(session.organizationId, new URL(req.url));
    return Response.json(await stampCardBlock(session.organizationId, period));
  } catch (err) {
    if (err instanceof PeriodError) return apiError(422, "invalid_period", err.message);
    throw err;
  }
});
