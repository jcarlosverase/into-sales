import { describe, expect, it } from "vitest";
import { templateWarnings, validateBodyVariables } from "@/lib/templates";
import { isTemplateLanguage } from "@/lib/template-languages";
import {
  INDUSTRIES,
  isAgentConfigured,
  isIndustryKey,
  sampleIdentity,
} from "@/server/seed/industry";

/** 023 — the four industry samples are loadable and safe. */
const samples = Object.values(INDUSTRIES);

describe("industry samples", () => {
  it("has the four commands' industries", () => {
    expect(Object.keys(INDUSTRIES).sort()).toEqual(["academy", "dental", "fashion", "realestate"]);
    expect(isIndustryKey("academy")).toBe(true);
    expect(isIndustryKey("ferreteria")).toBe(false);
  });

  it("sample identities can never be a phone or a WhatsApp id", () => {
    const id = sampleIdentity("academy", 1);
    expect(id).toBe("sample:academy:1");
    expect(id).not.toMatch(/^\d+$/);
    expect(id.startsWith("bsuid:")).toBe(false);
  });

  for (const sample of samples) {
    describe(sample.businessName, () => {
      it("loads 6 contacts spread across the pipeline, each with a conversation", () => {
        expect(sample.contacts).toHaveLength(6);
        const stages = new Set(sample.contacts.map((c) => c.stage));
        expect(stages.size).toBeGreaterThanOrEqual(4);
        for (const c of sample.contacts) {
          expect(c.thread.length).toBeGreaterThan(0);
          expect(c.thread[0]?.dir).toBe("in");
        }
      });

      it("has 3 templates Meta would accept as written", () => {
        expect(sample.templates).toHaveLength(3);
        for (const t of sample.templates) {
          expect(t.name).toMatch(/^[a-z0-9_]{1,60}$/);
          expect(isTemplateLanguage(t.language)).toBe(true);
          expect(validateBodyVariables(t.body)).toBeNull();
          expect(templateWarnings(t.body)).toEqual([]);
        }
      });

      it("prefixes its template names so industries never collide", () => {
        const prefix = sample.templates[0]!.name.split("_")[0];
        expect(sample.templates.every((t) => t.name.startsWith(`${prefix}_`))).toBe(true);
      });

      it("brings knowledge and a complete agent profile", () => {
        expect(sample.knowledge.some((k) => k.kind === "block")).toBe(true);
        expect(sample.knowledge.filter((k) => k.kind === "qa").length).toBeGreaterThanOrEqual(5);
        expect(isAgentConfigured(sample.agent)).toBe(true);
      });

      it("quotes prices in soles, never pesos", () => {
        const text = JSON.stringify(sample);
        expect(text).not.toMatch(/MXN|\$\d/);
      });
    });
  }

  it("the dental clinic books with at least 10 professionals inside its business hours (1029)", () => {
    const agenda = INDUSTRIES.dental.agenda!;
    expect(agenda.resources.length).toBeGreaterThanOrEqual(10);
    const names = agenda.resources.map((r) => r.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    for (const r of agenda.resources) {
      expect(r.name.length).toBeGreaterThan(0);
      expect(r.name.length).toBeLessThanOrEqual(60);
      const days = Object.entries(r.weeklyHours);
      expect(days.length).toBeGreaterThan(0);
      for (const [day, intervals] of days) {
        const open = agenda.weeklyHours[day as keyof typeof agenda.weeklyHours] ?? [];
        for (const i of intervals ?? []) {
          expect(i.start < i.end).toBe(true);
          expect(open.some((o) => o.start <= i.start && i.end <= o.end)).toBe(true);
        }
      }
    }
    // Every name the agent and the knowledge mention is a real professional.
    const team = INDUSTRIES.dental.knowledge.find(
      (k) => k.kind === "qa" && k.question.startsWith("¿Quiénes atienden")
    );
    expect(team).toBeDefined();
    for (const r of agenda.resources) {
      const person = r.name.replace(/ \(.*\)$/, "");
      expect(team!.kind === "qa" && team!.answer.includes(person)).toBe(true);
    }
  });

  it("template names are unique across industries", () => {
    const names = samples.flatMap((s) => s.templates.map((t) => t.name));
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("isAgentConfigured", () => {
  const empty = { tone: null, instructions: null, escalationRules: null, greeting: null };

  it("an untouched profile is not configured", () => {
    expect(isAgentConfigured(empty)).toBe(false);
    expect(isAgentConfigured({ ...empty, tone: "   " })).toBe(false);
  });

  it("any text means someone configured it (D6)", () => {
    expect(isAgentConfigured({ ...empty, greeting: "Hola" })).toBe(true);
  });
});
