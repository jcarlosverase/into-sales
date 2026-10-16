import path from "node:path";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { aiStatusOf, type AiStatus } from "@/lib/ai/provider";
import { getSql } from "@/lib/db";
import { resultText } from "@/lib/central";
import { readConfigCentral } from "@/server/central/flag";
import { getPublicLicense, type PublicLicense } from "@/server/central/license";
import { getBrainHealth } from "@/server/bot/status";
import { checkCentral, checkDispatch, checkWhatsApp, type CheckResult, type CheckStatus } from "@/server/doctor/checks";
import { mediaDirStatus, type MediaDirProbe } from "@/server/media-dir";
import type { BrainHealthDto } from "@/lib/brain-status";

/**
 * 1004 — «Ajustes → Salud»: cómo están el CRM y sus servicios ahora mismo.
 * Reusa los chequeos del doctor y del latido (028); aquí solo se ordenan y se
 * traducen a filas. Nunca un secreto (AC3): ni la URL de la base con su
 * contraseña, ni tokens; de WhatsApp, a lo más los últimos 4.
 */

export type HealthRowId = "database" | "migrations" | "media" | "whatsapp" | "ai" | "brain" | "central";

export type HealthRow = {
  id: HealthRowId;
  label: string;
  status: CheckStatus;
  detail: string;
  fix?: string;
};

type Sql = ReturnType<typeof getSql>;

export type SystemHealthDeps = {
  sql?: Sql;
  migrationsFolder?: string;
  env?: Record<string, string | undefined>;
  media?: () => Promise<MediaDirProbe | null>;
  whatsapp?: () => Promise<CheckResult[]>;
  ai?: (organizationId: string) => Promise<AiStatus>;
  brainHealth?: (url: string | undefined) => Promise<BrainHealthDto | null>;
  license?: (organizationId: string) => Promise<PublicLicense | null>;
};

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 200);

const WORST: CheckStatus[] = ["fail", "warn", "ok", "skip"];
const worst = (statuses: CheckStatus[]): CheckStatus => WORST.find((s) => statuses.includes(s)) ?? "skip";

export async function checkDatabaseRow(sql: Sql): Promise<HealthRow> {
  const label = "Base de datos";
  const started = performance.now();
  try {
    const [row] = await sql<{ version: string }[]>`select current_setting('server_version') as version`;
    const ms = Math.round(performance.now() - started);
    return { id: "database", label, status: "ok", detail: `Responde en ${ms} ms · PostgreSQL ${row?.version ?? "?"}` };
  } catch (error) {
    return {
      id: "database",
      label,
      status: "fail",
      detail: `No responde: ${errorText(error)}`,
      fix: "Revisa DATABASE_URL y que el contenedor de PostgreSQL esté arriba (pnpm doctor lo diagnostica).",
    };
  }
}

/** Las mismas reglas del migrador de Drizzle: cuántas de `drizzle/` faltan. */
export async function checkMigrationsRow(sql: Sql, folder = path.join(process.cwd(), "drizzle")): Promise<HealthRow> {
  const files = readMigrationFiles({ migrationsFolder: folder });
  const [table] = await sql<{ exists: boolean }[]>`select to_regclass('drizzle.__drizzle_migrations') is not null as exists`;
  let pending = files.length;
  if (table?.exists) {
    const [last] = await sql<{ created_at: string }[]>`select created_at from drizzle.__drizzle_migrations order by created_at desc limit 1`;
    const lastMs = last ? Number(last.created_at) : -Infinity;
    pending = files.filter((m) => m.folderMillis > lastMs).length;
  }
  return pending === 0
    ? { id: "migrations", label: "Migraciones", status: "ok", detail: `Todas aplicadas (${files.length})` }
    : {
        id: "migrations",
        label: "Migraciones",
        status: "fail",
        detail: `Faltan ${pending} de ${files.length}`,
        fix: "Se aplican al arrancar el contenedor; a mano: pnpm db:migrate.",
      };
}

export function mediaRow(probe: MediaDirProbe | null): HealthRow {
  const label = "Archivos (adjuntos, logo)";
  if (!probe) return { id: "media", label, status: "skip", detail: "MEDIA_DIR no está configurado" };
  return probe.writable
    ? { id: "media", label, status: "ok", detail: `${probe.dir} se puede escribir` }
    : {
        id: "media",
        label,
        status: "fail",
        detail: `${probe.dir} no se puede escribir (${probe.code}): no se guardarán adjuntos, logo ni icono`,
        fix: "Monta un volumen escribible en /data (ver docs/vps-installer.md).",
      };
}

export function whatsappRow(results: CheckResult[]): HealthRow {
  const label = "WhatsApp";
  const status = worst(results.map((r) => r.status));
  const detail = results.map((r) => r.detail ?? r.label).join(" · ") || "Sin número conectado";
  const fix = results.find((r) => r.status !== "ok" && r.fix)?.fix;
  return { id: "whatsapp", label, status: results.length ? status : "skip", detail, ...(fix ? { fix } : {}) };
}

export function aiRow(status: AiStatus): HealthRow {
  const label = "Inteligencia artificial";
  if (status.active) {
    return { id: "ai", label, status: "ok", detail: status.source === "org" ? `Llave guardada en Ajustes → IA (…${status.last4})` : `Llave del entorno (…${status.last4})` };
  }
  if (status.reason === "sin_configurar") {
    return { id: "ai", label, status: "skip", detail: "Sin configurar: el CRM funciona completo salvo el agente y el Laboratorio", fix: "Configúrala en Ajustes → IA." };
  }
  return {
    id: "ai",
    label,
    status: "fail",
    detail: status.reason === "sin_saldo" ? "El proveedor dice que la cuenta no tiene saldo" : "El proveedor rechazó la llave",
    fix: "Revisa la llave en Ajustes → IA y usa «Probar conexión».",
  };
}

export function brainRow(dispatch: CheckResult, health: BrainHealthDto | null): HealthRow {
  const label = "Cerebro externo";
  if (dispatch.status === "skip" && !health) return { id: "brain", label, status: "skip", detail: "No configurado: contesta el agente incluido" };
  if (health && !health.reachable) {
    return {
      id: "brain",
      label,
      status: "fail",
      detail: `${health.host || "BRAIN_HEALTH_URL"} no responde${health.httpStatus ? ` (HTTP ${health.httpStatus})` : ""}`,
      fix: "Revisa que el cerebro esté arriba y que BRAIN_HEALTH_URL apunte a su /health.",
    };
  }
  const parts = [dispatch.detail ?? ""];
  if (health) parts.push(`/health responde${health.version ? ` (versión ${health.version})` : ""}`);
  return { id: "brain", label, status: dispatch.status === "skip" ? "ok" : dispatch.status, detail: parts.filter(Boolean).join(" · "), ...(dispatch.fix && dispatch.status !== "ok" ? { fix: dispatch.fix } : {}) };
}

export function centralRow(config: CheckResult, license: PublicLicense | null): HealthRow {
  const label = "Servicio central de into";
  if (config.status !== "ok") {
    return { id: "central", label, status: config.status, detail: config.detail ?? "", ...(config.fix ? { fix: config.fix } : {}) };
  }
  if (!license) {
    return { id: "central", label, status: "warn", detail: "Encendido, pero sin llave de licencia: no late", fix: "Pega la llave en Ajustes → Plan." };
  }
  const text = resultText(license.lastResult);
  const status: CheckStatus = license.lastResult === "ok" ? "ok" : license.lastResult === null ? "warn" : text?.tone === "error" ? "fail" : "warn";
  return { id: "central", label, status, detail: text?.text ?? "Todavía no late", ...(status !== "ok" ? { fix: "Revisa Ajustes → Plan." } : {}) };
}

async function guarded(id: HealthRowId, label: string, run: () => Promise<HealthRow>): Promise<HealthRow> {
  try {
    return await run();
  } catch (error) {
    return { id, label, status: "fail", detail: `No se pudo comprobar: ${errorText(error)}` };
  }
}

/** AC1: todas las filas, en el orden de la pantalla. Nunca lanza (AC4). */
export async function runSystemHealth(organizationId: string, deps: SystemHealthDeps = {}): Promise<HealthRow[]> {
  const sql = deps.sql ?? getSql();
  const env = deps.env ?? process.env;
  const database = await checkDatabaseRow(sql);
  const dbDown = database.status === "fail";
  const skip = (id: HealthRowId, label: string): HealthRow => ({ id, label, status: "skip", detail: "Sin base de datos" });
  return [
    database,
    dbDown ? skip("migrations", "Migraciones") : await guarded("migrations", "Migraciones", () => checkMigrationsRow(sql, deps.migrationsFolder)),
    await guarded("media", "Archivos (adjuntos, logo)", async () => mediaRow(await (deps.media ?? mediaDirStatus)())),
    dbDown ? skip("whatsapp", "WhatsApp") : await guarded("whatsapp", "WhatsApp", async () => whatsappRow(await (deps.whatsapp ?? (() => checkWhatsApp()))())),
    dbDown ? skip("ai", "Inteligencia artificial") : await guarded("ai", "Inteligencia artificial", async () => aiRow(await (deps.ai ?? aiStatusOf)(organizationId))),
    await guarded("brain", "Cerebro externo", async () => brainRow(checkDispatch(env), await (deps.brainHealth ?? getBrainHealth)(env.BRAIN_HEALTH_URL))),
    await guarded("central", "Servicio central de into", async () =>
      centralRow(checkCentral(env), readConfigCentral(env).active && !dbDown ? await (deps.license ?? getPublicLicense)(organizationId) : null)),
  ];
}

export function summarizeHealth(rows: HealthRow[]): { level: CheckStatus; text: string } {
  const fails = rows.filter((r) => r.status === "fail").length;
  const warns = rows.filter((r) => r.status === "warn").length;
  if (fails > 0) return { level: "fail", text: `${fails} con problemas${warns ? ` y ${warns} con aviso` : ""}` };
  if (warns > 0) return { level: "warn", text: `Funciona, con ${warns} aviso${warns === 1 ? "" : "s"}` };
  return { level: "ok", text: "Todo en orden" };
}
