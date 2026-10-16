import { withAuth } from "@/lib/api";
import { listConversations } from "@/server/inbox/queries";
import { getLeadScope } from "@/server/leads/scope";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const sinceParam = url.searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : undefined;
  const conversations = await listConversations(
    session.organizationId,
    since && !Number.isNaN(since.getTime()) ? since : undefined,
    getLeadScope(session)
  );
  return Response.json({ conversations });
});
