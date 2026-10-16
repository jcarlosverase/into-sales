import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { eq } from "drizzle-orm";
import { getLeadScope } from "@/server/leads/scope";
import { todayList, type TodayFilter } from "@/server/leads/today";

export const dynamic = "force-dynamic";

/**
 * 029 — «A quién llamar hoy». `?vendedor=<userId>|sin_asignar|todos` only
 * counts for supervisors; a sales rep always gets their own list (D4).
 */
export const GET = withAuth(async (session, req: Request) => {
  const scope = getLeadScope(session);
  const raw = new URL(req.url).searchParams.get("vendedor") ?? "todos";
  const filter: TodayFilter =
    raw === "sin_asignar" ? { kind: "unassigned" } : raw === "todos" || !raw ? { kind: "all" } : { kind: "user", userId: raw };

  const list = await todayList(session.organizationId, scope, filter);
  // Supervisors pick whose list to see: the team, in the order they joined.
  const team =
    scope.kind === "all"
      ? await getDb()
          .select({ id: schema.user.id, name: schema.user.name })
          .from(schema.member)
          .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
          .where(scoped(schema.member.organizationId, session.organizationId))
          .orderBy(schema.member.createdAt)
      : [];
  return Response.json({ ...list, canFilter: scope.kind === "all", team });
});
