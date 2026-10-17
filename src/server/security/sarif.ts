/**
 * Resumen de los reportes SARIF del CI de seguridad (spec 1005): CodeQL y
 * Gitleaks los escriben, y aquí se cuentan, se ordenan por gravedad y se
 * decide si el check falla. Sin dependencias ni imports: el CLI
 * (scripts/sarif-summary.ts) lo corre Node directo, sin `pnpm install`.
 */

export type Severity = "critical" | "high" | "medium" | "low" | "note";

export type Finding = {
  tool: string;
  ruleId: string;
  severity: Severity;
  message: string;
  location: string;
};

type SarifRule = {
  id?: string;
  properties?: { "security-severity"?: string | number; "problem.severity"?: string };
  defaultConfiguration?: { level?: string };
};

type SarifResult = {
  ruleId?: string;
  rule?: { id?: string; index?: number };
  level?: string;
  message?: { text?: string };
  locations?: {
    physicalLocation?: { artifactLocation?: { uri?: string }; region?: { startLine?: number } };
  }[];
};

type SarifRun = {
  tool?: { driver?: { name?: string; rules?: SarifRule[] }; extensions?: { rules?: SarifRule[] }[] };
  results?: SarifResult[];
};

export type SarifLog = { runs?: SarifRun[] };

const ORDER: Severity[] = ["critical", "high", "medium", "low", "note"];

/** Los cortes de GitHub para `security-severity` (CVSS): 9, 7 y 4. */
export function severityFromScore(score: number): Severity {
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  return "low";
}

function severityOf(result: SarifResult, rule: SarifRule | undefined): Severity {
  const score = Number(rule?.properties?.["security-severity"]);
  if (Number.isFinite(score) && score > 0) return severityFromScore(score);
  // Sin puntaje (p. ej. Gitleaks, o reglas de calidad de CodeQL): el nivel SARIF.
  const level = result.level ?? rule?.defaultConfiguration?.level ?? "warning";
  if (level === "error") return "high";
  if (level === "warning") return "medium";
  return "note";
}

export function findingsOf(log: SarifLog): Finding[] {
  const findings: Finding[] = [];
  for (const run of log.runs ?? []) {
    const tool = run.tool?.driver?.name ?? "SARIF";
    const rules = new Map<string, SarifRule>();
    const all = [...(run.tool?.driver?.rules ?? []), ...(run.tool?.extensions ?? []).flatMap((e) => e.rules ?? [])];
    for (const rule of all) if (rule.id) rules.set(rule.id, rule);
    const driverRules = run.tool?.driver?.rules ?? [];
    for (const result of run.results ?? []) {
      const index = result.rule?.index;
      const byIndex = index !== undefined ? driverRules[index] : undefined;
      const ruleId = result.ruleId ?? result.rule?.id ?? byIndex?.id ?? "?";
      const rule = rules.get(ruleId) ?? byIndex;
      const physical = result.locations?.[0]?.physicalLocation;
      const uri = physical?.artifactLocation?.uri ?? "";
      const line = physical?.region?.startLine;
      findings.push({
        tool,
        ruleId,
        severity: severityOf(result, rule),
        // Una línea: el mensaje puede traer saltos y romper la tabla.
        message: (result.message?.text ?? "").replace(/\s+/g, " ").trim(),
        location: line ? `${uri}:${line}` : uri,
      });
    }
  }
  return findings.sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity));
}

/**
 * Hallazgos revisados y aceptados, como `regla@ruta`: se quitan del conteo solo
 * en esa ruta (o carpeta), así la misma regla sigue atenta en el resto. Cada uno
 * va con su porqué junto a donde se pasa (el workflow).
 */
export function withoutAccepted(findings: Finding[], accepted: string[]): Finding[] {
  const rules = accepted.map((entry) => {
    const at = entry.indexOf("@");
    return at < 0 ? { ruleId: entry, path: "" } : { ruleId: entry.slice(0, at), path: entry.slice(at + 1) };
  });
  return findings.filter(
    (f) => !rules.some((r) => r.ruleId === f.ruleId && f.location.startsWith(r.path))
  );
}

/** ¿Alguno llega al umbral? `failOn` es la gravedad mínima que bloquea. */
export function isBlocking(findings: Finding[], failOn: Severity): boolean {
  const limit = ORDER.indexOf(failOn);
  return findings.some((f) => ORDER.indexOf(f.severity) <= limit);
}

/** Tabla en Markdown para el resumen del job (`$GITHUB_STEP_SUMMARY`). */
export function markdownSummary(title: string, findings: Finding[], failOn: Severity): string {
  if (findings.length === 0) return `### ${title}\n\nSin hallazgos.\n`;
  const counts = ORDER.map((s) => [s, findings.filter((f) => f.severity === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${s}`)
    .join(" · ");
  const cell = (text: string) => text.replace(/\|/g, "\\|");
  const rows = findings.map(
    (f) => `| ${f.severity} | ${cell(f.tool)} | \`${cell(f.ruleId)}\` | ${cell(f.location)} | ${cell(f.message)} |`
  );
  const verdict = isBlocking(findings, failOn)
    ? `**Bloquea**: hay hallazgos de gravedad ${failOn} o mayor.`
    : `No bloquea: ninguno llega a ${failOn}.`;
  return [
    `### ${title}`,
    "",
    `${findings.length} hallazgos: ${counts}. ${verdict}`,
    "",
    "| Gravedad | Herramienta | Regla | Dónde | Detalle |",
    "|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}
