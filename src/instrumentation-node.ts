import type { Instrumentation } from "next";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { mediaDirStatus } from "@/server/media-dir";
import { readConfigDispatch } from "@/server/brains/config";
import { startWorker, batch } from "@/server/dispatch/worker";
import { readConfigCentral } from "@/server/central/flag";
import { startHeartbeats } from "@/server/central/heartbeat";
import { logger, routeConsoleToLogger } from "@/lib/observability/logger";
import { metrics } from "@/lib/observability/metrics";
import { safePath } from "@/lib/observability/safe-path";

/**
 * Spec 1006: from here on, console output (ours, Next's and the libraries')
 * comes out as one JSON line per event, like the rest of the logs.
 */
export function startLogging(): void {
  routeConsoleToLogger();
}

type OnRequestError = Instrumentation.onRequestError;

/**
 * Spec 1006: every uncaught error of a page, route or server action ends up
 * as one JSON line with its request ID, and in the error counter. The path
 * goes without its query string, and webhook paths without their token.
 */
export function logRequestError(
  error: unknown,
  request: Parameters<OnRequestError>[1],
  context: Parameters<OnRequestError>[2],
): void {
  const requestId = request.headers["x-request-id"];
  metrics.requestErrors.inc({ route_type: context.routeType });
  logger.error(
    {
      err: error,
      requestId: typeof requestId === "string" ? requestId : undefined,
      method: request.method,
      path: safePath(request.path),
      route: context.routePath,
      routeType: context.routeType,
    },
    "Request failed",
  );
}

/**
 * 008 — Aviso al arranque si MEDIA_DIR no es escribible. Sin esto, el primer
 * síntoma era un 500 al subir el logo o el icono, o adjuntos entrantes "no
 * disponibles" (se reintentan al abrirlos, pero solo mientras Meta los
 * conserve), con el EACCES enterrado en el log de un request. Se prueba
 * escribiendo de verdad (lo mismo que hará saveMediaFile) y nunca tumba el
 * arranque: el resto del CRM funciona sin adjuntos.
 *
 * El sondeo vive en `server/media-dir.ts` y es el mismo que `/api/health`
 * expone como `mediaWritable` (#82): este resultado queda cacheado y el
 * healthcheck lo reutiliza en vez de volver a escribir.
 */
export async function checkMediaDir(): Promise<void> {
  const media = await mediaDirStatus();
  // Sin entorno válido no hay nada que sondear: lo reporta, con detalle, el
  // primer getEnv() de la app.
  if (!media || media.writable) return;
  console.error(
    `[boot] MEDIA_DIR=${media.dir} no es escribible (${media.code}): los adjuntos entrantes, el logo y el icono NO se van a poder guardar. ` +
      "En Docker: monta un volumen persistente en /data (la imagen ya usa /data/media) y arranca el contenedor como root —el default—, " +
      "que el entrypoint le da el volumen al usuario de la app. Fuera de Docker: apunta MEDIA_DIR a un directorio escribible."
  );
}

/**
 * Limpieza al arranque (FR-034): corridas del Laboratorio que quedaron
 * "running" tras un reinicio → fallidas. Solo corre en el runtime Node.
 */
export async function cleanupOrphanRuns(): Promise<void> {
  try {
    const db = getDb();
    const updated = await db
      .update(schema.agentTestRun)
      .set({
        status: "failed",
        error: "Interrumpida por un reinicio del servidor",
        finishedAt: new Date(),
      })
      .where(eq(schema.agentTestRun.status, "running"))
      .returning({ id: schema.agentTestRun.id });
    if (updated.length > 0) {
      console.log(
        `[boot] ${updated.length} corrida(s) del Laboratorio huérfana(s) marcada(s) como fallida(s)`
      );
    }
  } catch (err) {
    // La BD puede no estar lista aún (migraciones corren antes del server).
    console.error("[boot] limpieza de corridas huérfanas falló:", err);
  }
}

/**
 * 021 — Reanuda el despacho al arrancar. Sin esto, un turno que quedó
 * pendiente o a medio reintentar cuando el contenedor se reinició esperaría a
 * que llegara OTRO mensaje para que alguien encendiera el worker.
 *
 * Solo con el despacho activo: una instancia sin cerebro no barre nada. Y lo
 * mal configurado se dice aquí una vez, además de en la tarjeta «Quién
 * responde»: es el log que alguien mira cuando el agente no contesta.
 */
export function resumeDispatch(): void {
  const config = readConfigDispatch();
  if (config.active) {
    startWorker();
    void batch();
    console.log(`[boot] despacho al cerebro activo → ${config.host}`);
    return;
  }
  if (config.problem === "url") {
    console.error(
      "[boot] BRAIN_DISPATCH_URL no es una URL http:// o https:// válida (sin usuario:clave): el despacho al cerebro queda INACTIVO."
    );
  } else if (config.problem === "sin_llave") {
    console.error(
      "[boot] BRAIN_DISPATCH_URL está definida pero falta BOT_API_KEY (mínimo 16 caracteres): el despacho al cerebro queda INACTIVO."
    );
  }
}

/**
 * 028 — Latido al servicio central de into, solo con la bandera
 * `INTO_CENTRAL_URL`. Mal escrita, se dice aquí una vez y el CRM sigue igual:
 * es un conector opcional (constitución II).
 */
export function startHeartbeatCentral(): void {
  const config = readConfigCentral();
  if (config.active) {
    startHeartbeats();
    console.log(`[boot] latido al servicio central → ${config.host}`);
  } else if (config.problem === "url") {
    console.error(
      "[boot] INTO_CENTRAL_URL no es una URL http:// o https:// válida (sin usuario:clave): el latido al servicio central queda INACTIVO."
    );
  }
}
