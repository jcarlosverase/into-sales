/**
 * Security CI CLI (spec 1005): summarizes one or more SARIF reports in the job
 * summary and exits with 1 if any finding reaches the threshold.
 *
 *   node scripts/sarif-summary.ts --title "CodeQL" --fail-on high \
 *     --accept js/rule@src/file.ts results/*.sarif
 *
 * Runs on Node 22's TypeScript support (no build, no dependencies).
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
if (skipped > 0) summary += `\n${skipped} finding(s) accepted on purpose (\`--accept\` in the workflow).\n`;
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
process.exit(isBlocking(findings, failOn) ? 1 : 0);
