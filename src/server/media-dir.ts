import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getEnv } from "@/lib/env";

/**
 * 008 / #82 — ¿Se puede escribir en MEDIA_DIR?
 *
 * Es la pregunta que decide si los adjuntos entrantes, el logo y el icono se
 * van a guardar. Se contesta escribiendo DE VERDAD (lo mismo que hará
 * `saveMediaFile`) y borrando el rastro, no mirando permisos.
 *
 * La hacen dos sitios: el arranque (`instrumentation-node.ts`, que avisa en
 * el log) y `/api/health` (que la expone como `mediaWritable`). El
 * healthcheck de Docker pega cada 15 s, y escribir en disco cada vez sería
 * ruido: el resultado se recuerda `MEDIA_DIR_PROBE_TTL_MS`, así que hay como
 * mucho una escritura por minuto, y la del arranque ya deja el primer
 * resultado listo.
 */

export type MediaDirProbe =
  | { dir: string; writable: true }
  | { dir: string; writable: false; code: string };

/** Sondeo real, sin caché: crea el directorio si falta, escribe y borra. */
export async function probeMediaDir(dir: string): Promise<MediaDirProbe> {
  const probe = path.join(dir, `.prueba-escritura-${process.pid}`);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(probe, "");
    await rm(probe, { force: true }).catch(() => {});
    return { dir, writable: true };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code ?? String(err);
    return { dir, writable: false, code };
  }
}

/** Cuánto vale un sondeo antes de volver a escribir. */
export const MEDIA_DIR_PROBE_TTL_MS = 60_000;

type ProbeCacheEntry = {
  dir: string;
  expiresAt: number;
  pending: Promise<MediaDirProbe>;
};

// En globalThis, como el cliente de BD y el estado del cerebro externo: los
// módulos pueden evaluarse más de una vez (una por ruta en dev), y el sondeo
// del arranque tiene que servirle a /api/health.
const globalForMedia = globalThis as unknown as {
  __intosalesMediaDirProbe?: ProbeCacheEntry;
};

/**
 * El sondeo con caché. Devuelve `null` si el entorno no valida: eso lo
 * reporta, con detalle, el primer `getEnv()` de la app, y aquí no hay
 * directorio que sondear.
 *
 * La caché va por directorio: si `MEDIA_DIR` cambia, se sondea el nuevo
 * aunque el anterior esté fresco.
 */
export async function mediaDirStatus(
  now: number = Date.now()
): Promise<MediaDirProbe | null> {
  let dir: string;
  try {
    dir = path.resolve(getEnv().MEDIA_DIR);
  } catch {
    return null;
  }
  const cached = globalForMedia.__intosalesMediaDirProbe;
  if (cached && cached.dir === dir && cached.expiresAt > now) {
    return cached.pending;
  }
  const pending = probeMediaDir(dir);
  globalForMedia.__intosalesMediaDirProbe = {
    dir,
    expiresAt: now + MEDIA_DIR_PROBE_TTL_MS,
    pending,
  };
  return pending;
}

/** Solo para tests. */
export function resetMediaDirCache(): void {
  delete globalForMedia.__intosalesMediaDirProbe;
}
