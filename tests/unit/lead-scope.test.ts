import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { schema } from "@/lib/db";
import {
  getLeadScope,
  seesEverything,
  visibleContactCondition,
} from "@/server/leads/scope";
import { isSupervisor } from "@/lib/auth/roles";

/** 022 — who sees what (AC6, AC9). */
describe("lead scope", () => {
  it("owners and admins see everything", () => {
    for (const role of ["owner", "admin"]) {
      const scope = getLeadScope({ userId: "usr_1", role });
      expect(scope).toEqual({ kind: "all" });
      expect(seesEverything(scope)).toBe(true);
      expect(isSupervisor(role)).toBe(true);
    }
  });

  it("a sales rep only sees what is assigned to them", () => {
    const scope = getLeadScope({ userId: "usr_2", role: "member" });
    expect(scope).toEqual({ kind: "assigned", userId: "usr_2" });
    expect(seesEverything(scope)).toBe(false);
  });

  it("an unknown role is treated as a sales rep, never as a supervisor", () => {
    expect(getLeadScope({ userId: "usr_3", role: "guest" }).kind).toBe("assigned");
  });

  it("adds no condition for supervisors", () => {
    expect(visibleContactCondition({ kind: "all" }, schema.contact.id)).toBeUndefined();
  });

  it("adds an ownership condition for sales reps, on its own alias of lead", () => {
    const condition = visibleContactCondition(
      { kind: "assigned", userId: "usr_2" },
      schema.lead.contactId
    );
    expect(condition).toBeDefined();
    // Rendered as Postgres sees it: the inner table must be aliased, or a
    // query FROM lead would compare a column with itself.
    const { sql, params } = new PgDialect().sqlToQuery(condition!);
    expect(sql).toContain('from "lead" as "owned_lead"');
    expect(sql).toContain('"owned_lead"."contact_id" = "lead"."contact_id"');
    expect(sql).toContain('"owned_lead"."assigned_user_id" = $1');
    expect(params).toEqual(["usr_2"]);
  });
});
