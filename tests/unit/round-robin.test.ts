import { describe, expect, it } from "vitest";
import { pickNextAssignee, type RotationRep } from "@/server/leads/round-robin";

/** 022 — the turn order of lead routing (AC1, AC2, AC3). */
const rep = (userId: string, receivesLeads = true): RotationRep => ({
  userId,
  receivesLeads,
});

describe("pickNextAssignee", () => {
  it("starts with the first rep when nobody has been served yet", () => {
    expect(pickNextAssignee([rep("a"), rep("b")], null)).toBe("a");
  });

  it("goes A, B, A with two reps (AC1)", () => {
    const reps = [rep("a"), rep("b")];
    const first = pickNextAssignee(reps, null);
    const second = pickNextAssignee(reps, first);
    const third = pickNextAssignee(reps, second);
    expect([first, second, third]).toEqual(["a", "b", "a"]);
  });

  it("skips reps taken out of the rotation (AC2)", () => {
    const reps = [rep("a"), rep("b", false), rep("c")];
    expect(pickNextAssignee(reps, "a")).toBe("c");
    expect(pickNextAssignee(reps, "c")).toBe("a");
  });

  it("continues right after the cursor even if its owner stopped receiving leads", () => {
    // B got the last lead and then went on vacation: the turn is C's, not A's.
    const reps = [rep("a"), rep("b", false), rep("c")];
    expect(pickNextAssignee(reps, "b")).toBe("c");
  });

  it("starts over when the cursor's owner left the team", () => {
    expect(pickNextAssignee([rep("a"), rep("b")], "gone")).toBe("a");
  });

  it("returns null when nobody receives leads (AC3)", () => {
    expect(pickNextAssignee([], null)).toBeNull();
    expect(pickNextAssignee([rep("a", false), rep("b", false)], "a")).toBeNull();
  });

  it("keeps giving leads to a single rep", () => {
    expect(pickNextAssignee([rep("a")], "a")).toBe("a");
  });
});
