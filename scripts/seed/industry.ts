/**
 * 023 — Industry sample data CLI:
 *
 *   pnpm seed:academy      Academia Horizonte
 *   pnpm seed:realestate   Inmobiliaria Altamira
 *   pnpm seed:fashion      Lúa Moda
 *
 * Flags:
 *   --reset             remove this industry's sample contacts and template drafts
 *   --overwrite-agent   replace the agent profile even if it was already configured
 *
 * Bundled with esbuild (alias @ → ./src), like the demo seed.
 * Spec: specs/027-datos-de-ejemplo-por-rubro/spec.md
 */
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { PG_CONNECTION_OPTIONS } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import {
  INDUSTRIES,
  isIndustryKey,
  resetIndustry,
  seedIndustry,
} from "@/server/seed/industry";

function loadEnvVar(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    const env = readFileSync(".env", "utf8");
    const line = env.split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim();
  } catch {
    return undefined;
  }
}

const args = process.argv.slice(2);
const key = args.find((a) => !a.startsWith("--")) ?? "";
if (!isIndustryKey(key)) {
  console.error(
    `[seed] Rubro desconocido "${key}". Usa uno de: ${Object.keys(INDUSTRIES).join(", ")}`
  );
  process.exit(1);
}
const sample = INDUSTRIES[key];

const url = loadEnvVar("DATABASE_URL");
if (!url) {
  console.error("[seed] DATABASE_URL no está definida");
  process.exit(1);
}

const sql = postgres(url, { max: 1, ...PG_CONNECTION_OPTIONS });
const db = drizzle(sql, { schema });

try {
  const [org] = await db.select().from(schema.organization).limit(1);
  if (!org) {
    console.error(
      "[seed] No hay organización: regístrate primero en la app y vuelve a correr el comando"
    );
    process.exitCode = 1;
  } else if (args.includes("--reset")) {
    const removed = await resetIndustry(db, org.id, sample);
    console.log(
      `[seed] ${sample.businessName}: quitados ${removed.contacts} contactos de ejemplo y ${removed.templates} borradores de plantilla.`
    );
  } else {
    const r = await seedIndustry(db, org.id, sample, {
      overwriteAgent: args.includes("--overwrite-agent"),
    });
    const legacyTotal = r.legacy.contacts + r.legacy.knowledge + r.legacy.labRuns;
    const lines = [
      `[seed] ${sample.businessName} cargado en "${org.name}":`,
      legacyTotal
        ? `  · quitada la demo vieja de ferretería: ${r.legacy.contacts} contactos, ${r.legacy.knowledge} entradas de conocimiento, ${r.legacy.labRuns} corrida del Laboratorio`
        : null,
      `  · ${r.contacts} contactos de ejemplo con conversación y lead (${r.assigned} asignados por turno)`,
      `  · ${r.templates} plantillas en borrador (envíalas a Meta desde Configuración → Plantillas)`,
      r.templatesSkipped.length
        ? `  · sin tocar, ya enviadas a Meta: ${r.templatesSkipped.join(", ")}`
        : null,
      `  · ${r.knowledgeAdded} entradas nuevas de conocimiento del agente`,
      r.agent === "applied"
        ? `  · perfil del agente configurado (${sample.agent.name}); el interruptor no se tocó`
        : "  · el agente ya estaba configurado y se dejó igual (usa --overwrite-agent para reemplazarlo)",
    ];
    console.log(lines.filter(Boolean).join("\n"));
  }
} catch (err) {
  console.error("[seed] Error:", err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
