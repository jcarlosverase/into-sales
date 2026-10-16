import { withAuth } from "@/lib/api";
import { getBranding } from "@/server/branding";
import { hygieneBlock } from "@/server/analytics/hygiene";
import { getLeadScope } from "@/server/leads/scope";

export const dynamic = "force-dynamic";

/** 019 — Higiene. Sin rango: describe el AHORA, no un periodo. */
export const GET = withAuth(async (session) => {
  const branding = await getBranding(session.organizationId);
  return Response.json(await hygieneBlock(session.organizationId, branding.currency, new Date(), getLeadScope(session)));
});
