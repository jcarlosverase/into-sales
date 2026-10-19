import { APP_VERSION, resolveCommit } from "@/lib/version";
import { heartbeatChecks } from "@/server/central/checks";
import {
  sendHeartbeat,
  nextInterval,
  type BodyHeartbeat,
  type ResultHeartbeat,
} from "@/server/central/client";
import { readConfigCentral } from "@/server/central/flag";
import { noteResult, getKey, organizationsWithKey } from "@/server/central/license";
import { metrics } from "@/lib/observability/metrics";

/**
 * 028 — El latido al servicio central. Corre fuera de cualquier petición de
 * usuario (salvo el inmediato al guardar la llave) y nunca lanza: un fallo del
 * central se anota y el siguiente latido llega a su hora (D4). Jamás escribe
 * la llave en el registro.
 */

/** Cuándo arrancó este proceso: viaja como `app_started_at`. */
const STARTUP = new Date();

export async function buildBody(organizationId: string): Promise<BodyHeartbeat> {
  const { commit } = resolveCommit();
  return {
    app_version: APP_VERSION,
    ...(commit ? { app_commit: commit } : {}),
    app_started_at: STARTUP.toISOString(),
    checks: await heartbeatChecks(organizationId),
  };
}

export type HeartbeatDone =
  | { done: false; reason: "apagado" | "sin_llave" }
  | { done: true; result: ResultHeartbeat; nextSeconds: number };

/** Un latido de una organización, ahora. Anota el resultado en su fila. */
export async function beatNow(organizationId: string, now: () => Date = () => new Date()): Promise<HeartbeatDone> {
  const config = readConfigCentral();
  if (!config.active) return { done: false, reason: "apagado" };
  const saved = await getKey(organizationId);
  if (!saved) return { done: false, reason: "sin_llave" };
  const result = await sendHeartbeat({
    url: config.url,
    key: saved.key,
    body: await buildBody(organizationId),
  });
  await noteResult(organizationId, result, now());
  metrics.centralHeartbeats.inc({ result: result.ok ? "ok" : result.result });
  const request = result.ok ? result.response.next_heartbeat_seconds : saved.interval;
  return { done: true, result: result, nextSeconds: nextInterval(request) };
}

const globalHeartbeat = globalThis as unknown as { __intoCentralTimer?: ReturnType<typeof setTimeout> | null };

/**
 * El temporizador: late al arrancar y vuelve a programarse con el intervalo
 * que pidió el central (D5). Con varias organizaciones, el más corto.
 */
export function startHeartbeats(log: (linea: string) => void = console.log): void {
  if (globalHeartbeat.__intoCentralTimer !== undefined) return;
  globalHeartbeat.__intoCentralTimer = null;

  const schedule = (seconds: number) => {
    const timer = setTimeout(() => void round(), seconds * 1000);
    timer.unref?.();
    globalHeartbeat.__intoCentralTimer = timer;
  };

  async function round(): Promise<void> {
    let next = nextInterval(null);
    try {
      const orgs = await organizationsWithKey();
      const intervals: number[] = [];
      for (const org of orgs) {
        try {
          const done = await beatNow(org);
          if (!done.done) continue;
          intervals.push(done.nextSeconds);
          if (!done.result.ok) {
            log(`[central] latido sin éxito: ${done.result.result}${done.result.http ? ` (HTTP ${done.result.http})` : ""}`);
          }
        } catch (err) {
          log(`[central] el latido falló: ${err instanceof Error ? err.name : "Error"}`);
        }
      }
      if (intervals.length > 0) next = Math.min(...intervals);
    } catch (err) {
      // La base puede no estar lista todavía: se reintenta a la hora normal.
      log(`[central] no se pudieron leer las llaves: ${err instanceof Error ? err.name : "Error"}`);
    }
    schedule(next);
  }

  void round();
}
