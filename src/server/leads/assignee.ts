import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/** 022 — How an assigned rep travels in API responses. */
export type AssigneeDto = { id: string; name: string };

/** The rep behind `assignedUserId`, or null when the lead is unassigned. */
export async function getAssignee(
  assignedUserId: string | null
): Promise<AssigneeDto | null> {
  if (!assignedUserId) return null;
  const rows = await getDb()
    .select({ id: schema.user.id, name: schema.user.name })
    .from(schema.user)
    .where(eq(schema.user.id, assignedUserId))
    .limit(1);
  return rows[0] ?? null;
}

/** Same as `getAssignee` for many leads at once (one query). */
export async function getAssignees(
  userIds: (string | null)[]
): Promise<Map<string, AssigneeDto>> {
  const ids = [...new Set(userIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return new Map();
  const rows = await getDb()
    .select({ id: schema.user.id, name: schema.user.name })
    .from(schema.user)
    .where(inArray(schema.user.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}
