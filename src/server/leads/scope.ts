import { and, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isSupervisor } from "@/lib/auth/roles";

/**
 * 022 — What a session is allowed to see.
 *
 * Supervisors (owner, admin) see everything. A sales rep sees only the leads
 * assigned to them, and through each lead its contact and conversations.
 * Everything else does not exist for them: detail routes answer 404, never
 * 403, so a rep cannot even confirm that someone else's lead exists (D8).
 *
 * The rule lives in one SQL condition (`visibleContactCondition`) so every
 * list and detail query applies exactly the same filter.
 */
export type LeadScope =
  | { kind: "all" }
  | { kind: "assigned"; userId: string };

export function getLeadScope(session: { userId: string; role: string }): LeadScope {
  return isSupervisor(session.role)
    ? { kind: "all" }
    : { kind: "assigned", userId: session.userId };
}

export function seesEverything(scope: LeadScope): boolean {
  return scope.kind === "all";
}

/**
 * Condition on a `contact.id`-like column: "this contact has a lead assigned
 * to the rep". `undefined` for supervisors, so it plugs straight into
 * `scoped(...)`, which ignores undefined conditions.
 */
export function visibleContactCondition(
  scope: LeadScope,
  contactIdColumn: PgColumn
): SQL | undefined {
  if (scope.kind === "all") return undefined;
  // The inner `lead` gets its own name (`owned_lead`): in a query that is
  // itself FROM `lead`, an unaliased subquery would compare the inner column
  // with itself and let every lead through. (Queries FROM `lead` should use
  // `ownLeadCondition` anyway.)
  return sql`exists (
    select 1 from ${sql.raw('"lead" as "owned_lead"')}
    where ${sql.raw('"owned_lead"."contact_id"')} = ${contactIdColumn}
      and ${sql.raw('"owned_lead"."assigned_user_id"')} = ${scope.userId}
  )`;
}

/** Condition for queries that are FROM `lead`: "this lead is the rep's". */
export function ownLeadCondition(scope: LeadScope): SQL | undefined {
  if (scope.kind === "all") return undefined;
  return eq(schema.lead.assignedUserId, scope.userId);
}

/** Can this scope see the contact? (Organization is checked too.) */
export async function canSeeContact(
  scope: LeadScope,
  organizationId: string,
  contactId: string
): Promise<boolean> {
  if (scope.kind === "all") return true;
  const db = getDb();
  const rows = await db
    .select({ id: schema.lead.id })
    .from(schema.lead)
    .where(
      scoped(
        schema.lead.organizationId,
        organizationId,
        eq(schema.lead.contactId, contactId),
        eq(schema.lead.assignedUserId, scope.userId)
      )
    )
    .limit(1);
  return rows.length > 0;
}

/** Can this scope see the lead? */
export async function canSeeLead(
  scope: LeadScope,
  organizationId: string,
  leadId: string
): Promise<boolean> {
  if (scope.kind === "all") return true;
  const db = getDb();
  const rows = await db
    .select({ id: schema.lead.id })
    .from(schema.lead)
    .where(
      scoped(
        schema.lead.organizationId,
        organizationId,
        eq(schema.lead.id, leadId),
        eq(schema.lead.assignedUserId, scope.userId)
      )
    )
    .limit(1);
  return rows.length > 0;
}

/** Can this scope see the conversation (through its contact's lead)? */
export async function canSeeConversation(
  scope: LeadScope,
  organizationId: string,
  conversationId: string
): Promise<boolean> {
  if (scope.kind === "all") return true;
  const db = getDb();
  const rows = await db
    .select({ id: schema.conversation.id })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.id, conversationId),
        visibleContactCondition(scope, schema.conversation.contactId)
      )
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Can this scope see the media asset? An asset belongs either to a message
 * (its conversation decides) or to an ad's creative (its contact decides).
 */
export async function canSeeMediaAsset(
  scope: LeadScope,
  organizationId: string,
  assetId: string
): Promise<boolean> {
  if (scope.kind === "all") return true;
  const db = getDb();
  const viaMessage = await db
    .select({ id: schema.message.id })
    .from(schema.message)
    .innerJoin(
      schema.conversation,
      eq(schema.conversation.id, schema.message.conversationId)
    )
    .where(
      scoped(
        schema.message.organizationId,
        organizationId,
        eq(schema.message.mediaAssetId, assetId),
        visibleContactCondition(scope, schema.conversation.contactId)
      )
    )
    .limit(1);
  if (viaMessage.length > 0) return true;

  const viaAd = await db
    .select({ id: schema.adAttribution.id })
    .from(schema.adAttribution)
    .where(
      and(
        eq(schema.adAttribution.organizationId, organizationId),
        eq(schema.adAttribution.imageAssetId, assetId),
        visibleContactCondition(scope, schema.adAttribution.contactId)
      )
    )
    .limit(1);
  return viaAd.length > 0;
}

/**
 * 022, D11 — Condition on `booking`: a rep sees the bookings of their own
 * contacts plus calendar blocks (no contact: they only say when there is no
 * room). `undefined` for supervisors.
 */
export function visibleBookingCondition(scope: LeadScope): SQL | undefined {
  if (scope.kind === "all") return undefined;
  return or(isNull(schema.booking.contactId), visibleContactCondition(scope, schema.booking.contactId));
}

/** 022, D11 — Can this scope act on the booking? Someone else's is 404. */
export async function canSeeBooking(
  scope: LeadScope,
  organizationId: string,
  bookingId: string
): Promise<boolean> {
  if (scope.kind === "all") return true;
  const rows = await getDb()
    .select({ id: schema.booking.id })
    .from(schema.booking)
    .where(
      scoped(
        schema.booking.organizationId,
        organizationId,
        eq(schema.booking.id, bookingId),
        visibleBookingCondition(scope)
      )
    )
    .limit(1);
  return rows.length > 0;
}
