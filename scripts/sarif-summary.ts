/**
 * CLI del CI de seguridad (spec 1005): resume uno o más reportes SARIF en el
 * resumen del job y sale con 1 si algún hallazgo llega al umbral.
 *
 *   node scripts/sarif-summary.ts --title "CodeQL" --fail-on high \
 *     --accept js/regla@src/archivo.ts results/*.sarif
 *
 * Corre con el soporte de TypeScript de Node 22 (sin build ni dependencias).
 */
import { appendFileSync, readFileSync } from "node:fs";
import { findingsOf, isBlocking, markdownSummary, withoutAccepted, type SarifLog, type Severity } from "../src/server/security/sarif.ts";

const args = process.argv.slice(2);
let title = "SARIF";
let failOn: Severity = "high";
const files: string[] = [];
const accepted: string[] = [];
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--title") title = args[++i] ?? title;
  else if (arg === "--fail-on") failOn = (args[++i] ?? failOn) as Severity;
  else if (arg === "--accept") accepted.push(args[++i] ?? "");
  else if (arg) files.push(arg);
}

const all = files.flatMap((file) => findingsOf(JSON.parse(readFileSync(file, "utf8")) as SarifLog));
const findings = withoutAccepted(all, accepted.filter(Boolean));
const skipped = all.length - findings.length;
let summary = markdownSummary(title, findings, failOn);
if (skipped > 0) summary += `\n${skipped} hallazgo(s) aceptado(s) a propósito (\`--accept\` en el workflow).\n`;
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
process.exit(isBlocking(findings, failOn) ? 1 : 0);
