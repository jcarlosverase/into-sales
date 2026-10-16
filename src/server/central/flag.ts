/**
 * 028 — ¿Esta instancia late al servicio central de into?
 *
 * Conector opcional (constitución II y VIII, 1.5.0): la bandera es
 * `INTO_CENTRAL_URL`, la URL base del central (en producción
 * `https://api.into.center`). Vacía o ausente, el conector no existe: no hay
 * pantalla «Plan», la API de ajustes da 404 y no corre ningún temporizador.
 *
 * Mal escrita (que no sea http(s), o que traiga usuario:clave) NO está activa:
 * se dice al arrancar y en `pnpm doctor`, y el CRM sigue igual. Igual que
 * `leerConfigDespacho()`, se lee de `process.env` directo y no por
 * `getEnv()`: preguntar si una feature existe nunca depende de que todo el
 * entorno valide.
 */

export type ConfigCentral =
  | { active: true; url: string; host: string }
  | { active: false; host: string | null; problem: "url" | null };

type Environment = Record<string, string | undefined>;

/** Pura sobre el entorno que recibe: la usan el latido, la pantalla, la salud y el doctor. */
export function readConfigCentral(env: Environment = process.env): ConfigCentral {
  const raw = env.INTO_CENTRAL_URL?.trim();
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
  if (target.username || target.password) {
    return { active: false, host: target.host, problem: "url" };
  }
  // Sin la barra final: las rutas del contrato se le agregan (`/v1/heartbeat`).
  const url = `${target.origin}${target.pathname.replace(/\/+$/, "")}`;
  return { active: true, url, host: target.host };
}

export function centralEnabled(): boolean {
  return readConfigCentral().active;
}

/** Superficie apagada: 404, como la agenda. Sin bandera, esto no existe. */
export function centralDisabledResponse(): Response {
  return new Response(null, { status: 404 });
}
