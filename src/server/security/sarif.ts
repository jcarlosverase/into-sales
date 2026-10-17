/**
 * Summary of the security CI's SARIF reports (spec 1005): CodeQL and Gitleaks
 * write them, and here they are counted, sorted by severity and checked
 * against the failure threshold. No dependencies or imports: the CLI
 * (scripts/sarif-summary.ts) runs it with plain Node, without `pnpm install`.
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

/** GitHub's cut-offs for `security-severity` (CVSS): 9, 7 and 4. */
export function severityFromScore(score: number): Severity {
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  return "low";
}

function severityOf(result: SarifResult, rule: SarifRule | undefined): Severity {
  const score = Number(rule?.properties?.["security-severity"]);
  if (Number.isFinite(score) && score > 0) return severityFromScore(score);
  // No score (e.g. Gitleaks, or CodeQL quality rules): use the SARIF level.
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
        // One line: the message may contain line breaks and break the table.
        message: (result.message?.text ?? "").replace(/\s+/g, " ").trim(),
        location: line ? `${uri}:${line}` : uri,
      });
    }
  }
  return findings.sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity));
}

/**
 * Reviewed and accepted findings, as `rule@path`: they are dropped from the
 * count only at that path (or folder), so the same rule keeps watching
 * everywhere else. Each one carries its reason where it is passed (the workflow).
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

/** Does any finding reach the threshold? `failOn` is the lowest blocking severity. */
export function isBlocking(findings: Finding[], failOn: Severity): boolean {
  const limit = ORDER.indexOf(failOn);
  return findings.some((f) => ORDER.indexOf(f.severity) <= limit);
}

/** Markdown table for the job summary (`$GITHUB_STEP_SUMMARY`). */
export function markdownSummary(title: string, findings: Finding[], failOn: Severity): string {
  if (findings.length === 0) return `### ${title}\n\nNo findings.\n`;
  const counts = ORDER.map((s) => [s, findings.filter((f) => f.severity === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${s}`)
    .join(" · ");
  // Backslashes first: otherwise a `\|` in the text would cancel the escape.
  const cell = (text: string) => text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
  const rows = findings.map(
    (f) => `| ${f.severity} | ${cell(f.tool)} | \`${cell(f.ruleId)}\` | ${cell(f.location)} | ${cell(f.message)} |`
  );
  const verdict = isBlocking(findings, failOn)
    ? `**Blocking**: there are findings of severity ${failOn} or higher.`
    : `Not blocking: none reaches ${failOn}.`;
  return [
    `### ${title}`,
    "",
    `${findings.length} findings: ${counts}. ${verdict}`,
    "",
    "| Severity | Tool | Rule | Location | Details |",
    "|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}
