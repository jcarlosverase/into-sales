/**
 * Spec 1018 — La sesión se cierra tras 12 horas sin uso.
 *
 * Sin React ni Better Auth: lo usan la configuración del servidor
 * (`lib/auth/index.ts`) y el componente que la renueva en el navegador
 * (`components/session-keep-alive.tsx`).
 */

/** Horas sin uso tras las que la sesión vence (cookie y fila en la base). */
export const SESSION_IDLE_HOURS = 12;
export const SESSION_EXPIRES_IN_SECONDS = SESSION_IDLE_HOURS * 60 * 60;

/**
 * Cada cuánto, como mucho, se renueva la sesión mientras alguien trabaja.
 * Better Auth no la toca antes de este tiempo desde la última renovación.
 */
export const SESSION_REFRESH_SECONDS = 10 * 60;

/**
 * ¿Toca pedir la renovación? Solo si hubo actividad REAL (clic, tecla, toque)
 * después de la última renovación y ya pasó el intervalo: una pestaña abierta
 * que nadie usa no mantiene viva la sesión.
 */
export function shouldRefreshSession(input: {
  now: number;
  lastActivityAt: number;
  lastRefreshAt: number;
}): boolean {
  return (
    input.lastActivityAt > input.lastRefreshAt &&
    input.now - input.lastRefreshAt >= SESSION_REFRESH_SECONDS * 1000
  );
}
