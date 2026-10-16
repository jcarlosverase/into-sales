import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { SALES_REP_ROLE } from "@/lib/auth/roles";
import { pickNextAssignee } from "@/server/leads/round-robin";

/**
 * 022 — Lead routing: who gets each new lead, and the settings behind it.
 *
 * The rotation lives in `lead_routing` (one row per organization) and is
 * taken with `SELECT … FOR UPDATE`, in the same transaction that writes the
 * cursor and the lead: two messages arriving at once can never hand the same
 * turn to the same rep.
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type RoutingRep = {
  userId: string;
  name: string;
  email: string;
  receivesLeads: boolean;
};

export type RoutingSettings = {
  enabled: boolean;
  /** Sales reps in rotation order, including the ones taken out of it. */
  members: RoutingRep[];
};

/** Sales reps of the organization in rotation order (who joined first). */
async function listRotationReps(
  db: Db | Tx,
  organizationId: string
): Promise<RoutingRep[]> {
  const rows = await db
    .select({
      userId: schema.member.userId,
      name: schema.user.name,
      email: schema.user.email,
      receivesLeads: schema.leadRoutingMember.receivesLeads,
    })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .leftJoin(
      schema.leadRoutingMember,
      and(
        eq(schema.leadRoutingMember.organizationId, schema.member.organizationId),
        eq(schema.leadRoutingMember.userId, schema.member.userId)
      )
    )
    .where(
      scoped(
        schema.member.organizationId,
        organizationId,
        eq(schema.member.role, SALES_REP_ROLE)
      )
    )
    .orderBy(asc(schema.member.createdAt), asc(schema.member.id));

  return rows.map((r) => ({
    userId: r.userId,
    name: r.name,
    email: r.email,
    // No row = the default: the rep receives leads.
    receivesLeads: r.receivesLeads ?? true,
  }));
}

async function ensureRoutingRow(db: Db | Tx, organizationId: string) {
  await db
    .insert(schema.leadRouting)
    .values({ organizationId })
    .onConflictDoNothing({ target: schema.leadRouting.organizationId });
}

/**
 * Assigns `leadId` to the next rep in the rotation. Returns the chosen user,
 * or null when routing is off or nobody receives leads (the lead stays
 * unassigned and only supervisors see it).
 */
export async function assignLeadByRotation(
  organizationId: string,
  leadId: string,
  /** The app's connection by default; CLI scripts (seeds) pass their own. */
  db: Db = getDb()
): Promise<string | null> {
  return db.transaction(async (tx) => {
    await ensureRoutingRow(tx, organizationId);
    const [routing] = await tx
      .select()
      .from(schema.leadRouting)
      .where(eq(schema.leadRouting.organizationId, organizationId))
      .for("update");
    if (!routing?.enabled) return null;

    const reps = await listRotationReps(tx, organizationId);
    const userId = pickNextAssignee(reps, routing.lastAssignedUserId);
    if (!userId) return null;

    const now = new Date();
    await tx
      .update(schema.leadRouting)
      .set({ lastAssignedUserId: userId, updatedAt: now })
      .where(eq(schema.leadRouting.organizationId, organizationId));
    await tx
      .update(schema.lead)
      .set({ assignedUserId: userId, assignedAt: now, updatedAt: now })
      .where(
        scoped(schema.lead.organizationId, organizationId, eq(schema.lead.id, leadId))
      );
    return userId;
  });
}

export async function getRoutingSettings(
  organizationId: string
): Promise<RoutingSettings> {
  const db = getDb();
  const [routing] = await db
    .select({ enabled: schema.leadRouting.enabled })
    .from(schema.leadRouting)
    .where(eq(schema.leadRouting.organizationId, organizationId))
    .limit(1);
  return {
    // No row yet = never configured = on (D4).
    enabled: routing?.enabled ?? true,
    members: await listRotationReps(db, organizationId),
  };
}

export class RoutingError extends Error {
  constructor(
    public readonly code: "invalid_member",
    message: string
  ) {
    super(message);
    this.name = "RoutingError";
  }
}

/** Turns routing on/off and/or changes whether one rep receives new leads. */
export async function updateRoutingSettings(
  organizationId: string,
  patch: { enabled?: boolean; userId?: string; receivesLeads?: boolean }
): Promise<RoutingSettings> {
  const db = getDb();
  const now = new Date();

  if (patch.userId !== undefined && patch.receivesLeads !== undefined) {
    const reps = await listRotationReps(db, organizationId);
    if (!reps.some((r) => r.userId === patch.userId)) {
      throw new RoutingError(
        "invalid_member",
        "Ese usuario no es vendedor de este equipo"
      );
    }
    await db
      .insert(schema.leadRoutingMember)
      .values({
        id: newId("leadRoutingMember"),
        organizationId,
        userId: patch.userId,
        receivesLeads: patch.receivesLeads,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          schema.leadRoutingMember.organizationId,
          schema.leadRoutingMember.userId,
        ],
        set: { receivesLeads: patch.receivesLeads, updatedAt: now },
      });
  }

  if (patch.enabled !== undefined) {
    await ensureRoutingRow(db, organizationId);
    await db
      .update(schema.leadRouting)
      .set({ enabled: patch.enabled, updatedAt: now })
      .where(eq(schema.leadRouting.organizationId, organizationId));
  }

  return getRoutingSettings(organizationId);
}
