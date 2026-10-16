/**
 * 022 — Round-robin choice, as a pure function so the order can be tested
 * without a database (see `routing.ts` for the locked transaction around it).
 */

export type RotationRep = {
  userId: string;
  /** False when the rep was taken out of the rotation ("Recibe leads nuevos"). */
  receivesLeads: boolean;
};

/**
 * `reps` is the whole team of sales reps in rotation order (who joined first),
 * including the ones taken out of the rotation: keeping them in the list is
 * what lets the turn continue right after the cursor even when the cursor's
 * owner no longer receives leads. The next assignee is the first rep after
 * `lastAssignedUserId` that receives leads, wrapping around. A cursor that is
 * not in the list at all (that user left) starts over from the top.
 */
export function pickNextAssignee(
  reps: readonly RotationRep[],
  lastAssignedUserId: string | null
): string | null {
  if (reps.length === 0) return null;
  const cursor = lastAssignedUserId
    ? reps.findIndex((r) => r.userId === lastAssignedUserId)
    : -1;
  for (let step = 1; step <= reps.length; step++) {
    const rep = reps[(cursor + step) % reps.length];
    if (rep?.receivesLeads) return rep.userId;
  }
  return null;
}
