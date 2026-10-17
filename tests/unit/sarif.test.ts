import { describe, expect, it } from "vitest";
import {
  findingsOf,
  isBlocking,
  markdownSummary,
  severityFromScore,
  withoutAccepted,
  type SarifLog,
} from "@/server/security/sarif";

// Recortes de lo que escriben CodeQL (reglas en extensions, con
// security-severity) y Gitleaks (reglas en driver, solo nivel SARIF).
const codeql: SarifLog = {
  runs: [
    {
      tool: {
        driver: { name: "CodeQL" },
        extensions: [
          {
            rules: [
              { id: "js/sql-injection", properties: { "security-severity": "8.8" } },
              { id: "js/xss", properties: { "security-severity": "6.1" } },
              { id: "js/unused", defaultConfiguration: { level: "note" } },
            ],
          },
        ],
      },
      results: [
        {
          ruleId: "js/xss",
          message: { text: "Cross-site\nscripting" },
          locations: [{ physicalLocation: { artifactLocation: { uri: "src/a.ts" }, region: { startLine: 3 } } }],
        },
        {
          ruleId: "js/sql-injection",
          message: { text: "SQL | injection" },
          locations: [{ physicalLocation: { artifactLocation: { uri: "src/server/db.ts" }, region: { startLine: 9 } } }],
        },
        { ruleId: "js/unused", message: { text: "unused" } },
      ],
    },
  ],
};

const gitleaks: SarifLog = {
  runs: [
    {
      tool: { driver: { name: "gitleaks", rules: [{ id: "generic-api-key" }] } },
      results: [
        {
          rule: { index: 0 },
          message: { text: "secret" },
          locations: [{ physicalLocation: { artifactLocation: { uri: ".env.example" }, region: { startLine: 1 } } }],
        },
      ],
    },
  ],
};

describe("severityFromScore", () => {
  it("usa los cortes de GitHub", () => {
    expect(severityFromScore(9.8)).toBe("critical");
    expect(severityFromScore(7)).toBe("high");
    expect(severityFromScore(4)).toBe("medium");
    expect(severityFromScore(3.9)).toBe("low");
  });
});

describe("findingsOf", () => {
  it("toma la gravedad del puntaje y ordena de mayor a menor", () => {
    const findings = findingsOf(codeql);
    expect(findings.map((f) => [f.ruleId, f.severity])).toEqual([
      ["js/sql-injection", "high"],
      ["js/xss", "medium"],
      ["js/unused", "note"],
    ]);
    expect(findings[1]).toMatchObject({ tool: "CodeQL", location: "src/a.ts:3", message: "Cross-site scripting" });
  });

  it("sin puntaje usa el nivel SARIF y encuentra la regla por índice", () => {
    expect(findingsOf(gitleaks)).toEqual([
      { tool: "gitleaks", ruleId: "generic-api-key", severity: "medium", message: "secret", location: ".env.example:1" },
    ]);
  });

  it("un reporte vacío no trae hallazgos", () => {
    expect(findingsOf({})).toEqual([]);
    expect(findingsOf({ runs: [{ results: [] }] })).toEqual([]);
  });
});

describe("isBlocking", () => {
  it("bloquea desde el umbral hacia arriba", () => {
    const findings = findingsOf(codeql);
    expect(isBlocking(findings, "high")).toBe(true);
    expect(isBlocking(findings, "critical")).toBe(false);
    expect(isBlocking([], "note")).toBe(false);
  });
});

describe("withoutAccepted", () => {
  it("quita la regla solo en la ruta aceptada", () => {
    const findings = findingsOf(codeql);
    expect(withoutAccepted(findings, ["js/sql-injection@src/server/"]).map((f) => f.ruleId)).toEqual([
      "js/xss",
      "js/unused",
    ]);
    expect(withoutAccepted(findings, ["js/sql-injection@src/other.ts"])).toHaveLength(3);
  });
});

describe("markdownSummary", () => {
  it("cuenta, dice si bloquea y escapa las barras de la tabla", () => {
    const md = markdownSummary("CodeQL", findingsOf(codeql), "high");
    expect(md).toContain("3 hallazgos: 1 high · 1 medium · 1 note. **Bloquea**");
    expect(md).toContain("SQL \\| injection");
  });

  it("sin hallazgos lo dice", () => {
    expect(markdownSummary("Gitleaks", [], "note")).toContain("Sin hallazgos.");
  });
});
