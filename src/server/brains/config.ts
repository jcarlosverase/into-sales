/**
 * 021 — ¿Hay un cerebro al que despacharle? Dos cosas, y las dos por entorno:
 * `BRAIN_DISPATCH_URL` (a dónde) y `BOT_API_KEY` (con qué se firma, y con qué
 * contesta el cerebro por `/api/bot/*`).
 *
 * Activo, el despacho silencia al agente incluido: los dos caminos son
 * excluyentes (`server/ai/trigger.ts`). Mal configurado NO está activo: todo
 * se comporta como si la variable no existiera y la tarjeta «Quién responde»
 * dice qué corregir. Preferible a dejar la instancia muda por una URL mal
 * escrita.
 *
 * A diferencia de la edición cloud, aquí no se exige una URL pública: la pone
 * quien instala, no un tercero, y lo normal es la dirección interna del
 * contenedor del cerebro (`http://nea:8000/vocero/dispatch`).
 */

const MIN_KEY_LENGTH = 16;

export type ProblemDispatch =
  /** `BRAIN_DISPATCH_URL` no es una URL http(s), o lleva usuario y clave. */
  | "url"
  /** Falta `BOT_API_KEY` (o mide menos de 16): no hay con qué firmar. */
  | "sin_llave";

export type ConfigDispatch =
  | { active: true; url: string; host: string; secret: string }
  | { active: false; host: string | null; problem: ProblemDispatch | null };

type Environment = Record<string, string | undefined>;

/** Pura sobre el entorno que recibe: la usan el worker, la tarjeta y `pnpm doctor`. */
export function readConfigDispatch(env: Environment = process.env): ConfigDispatch {
  const raw = env.BRAIN_DISPATCH_URL?.trim();
  if (!raw) return { active: false, host: null, problem: null };

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return { active: false, host: null, problem: "url" };
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return { active: false, host: null, problem: "url" };
  }
  // Sin credenciales en la URL: el despacho ya va firmado, y `fetch` rechaza
  // una URL que las trae. Mejor decirlo que fallar en cada turno.
  if (target.username || target.password) {
    return { active: false, host: target.host, problem: "url" };
  }

  const secret = env.BOT_API_KEY;
  if (typeof secret !== "string" || secret.length < MIN_KEY_LENGTH) {
    return { active: false, host: target.host, problem: "sin_llave" };
  }
  return { active: true, url: target.toString(), host: target.host, secret };
}

/** El CRM está empujando turnos a un cerebro. */
export function activeDispatch(): boolean {
  return readConfigDispatch().active;
}
