import { describe, expect, it } from "vitest";
import { templateWarnings, validateBodyVariables } from "@/lib/templates";
import { isTemplateLanguage } from "@/lib/template-languages";
import {
  INDUSTRIES,
  isAgentConfigured,
  isIndustryKey,
  sampleIdentity,
} from "@/server/seed/industry";

/** 023 — the three industry samples are loadable and safe. */
const samples = Object.values(INDUSTRIES);

describe("industry samples", () => {
  it("has the three commands' industries", () => {
    expect(Object.keys(INDUSTRIES).sort()).toEqual(["academy", "fashion", "realestate"]);
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
