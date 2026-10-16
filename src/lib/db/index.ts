import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

/**
 * Opciones de conexión comunes a TODA conexión que abra este repo (app, seeds,
 * migraciones, arneses E2E).
 *
 * Las columnas de fecha son `timestamptz` (spec 1002) y la base tiene por
 * defecto la zona de Lima: quien la abre con psql o un panel ve la hora de
 * Lima (`-05`). La app, en cambio, fija su sesión en UTC a propósito: ya no
 * hace falta para `now()` (un `timestamptz` guarda el instante), pero deja en
 * UTC todo lo que depende de la zona de la sesión —`::date`, `to_char`, un
 * texto sin zona— y el código aplica la zona del negocio solo donde la pide
 * (Resultados, agenda, «Hoy»).
 *
 * Historia: con `timestamp without time zone`, un Postgres en UTC-5 hacía que
 * `now()` escribiera hora LOCAL y se leyera como UTC (08:59 en la burbuja del
 * hilo, 14:59 en la lista). Por eso nació esta opción.
 */
export const PG_CONNECTION_OPTIONS = {
  onnotice: () => {},
  connection: { TimeZone: "UTC" },
} as const;

/**
 * Cliente de BD único por proceso. En dev, Next recarga módulos: se cachea en
 * globalThis para no agotar conexiones.
 */
const globalForDb = globalThis as unknown as {
  __voceroSql?: ReturnType<typeof postgres>;
};

function createClient() {
  const env = getEnv();
  return postgres(env.DATABASE_URL, {
    max: 10,
    ...PG_CONNECTION_OPTIONS,
  });
}

export function getSql() {
  if (!globalForDb.__voceroSql) globalForDb.__voceroSql = createClient();
  return globalForDb.__voceroSql;
}

let cachedDb: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!cachedDb) cachedDb = drizzle(getSql(), { schema });
  return cachedDb;
}

export { schema };
