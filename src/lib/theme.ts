/**
 * Tema claro/oscuro. La preferencia es POR DISPOSITIVO (cookie), no por
 * organización ni por usuario en BD: quien trabaja de noche no se lo impone a
 * su equipo, y no hace falta migración.
 *
 * Sin parpadeo y sin script de arranque: la preferencia SIEMPRE es explícita,
 * así que el layout raíz escribe `data-theme` en el HTML del servidor y el
 * primer pintado ya llega con el tema correcto.
 *
 * No hay opción "seguir al sistema" a propósito: el CRM se usa toda la jornada
 * y un cambio automático al anochecer sorprende en mitad de una conversación.
 *
 * Spec 1021: los tipos y helpers comunes vienen del sistema de diseño into;
 * aquí queda lo propio de IntoSales: el nombre de sus cookies.
 */
import type { ThemePreference } from "@into/designsystem";

export {
  nextThemePreference,
  normalizeThemePreference,
  THEME_COOKIE_MAX_AGE,
  THEME_LABELS,
  type ThemePreference,
} from "@into/designsystem";

export const THEME_COOKIE = "intosales-theme";
/**
 * Spec 1013: el nombre de antes. Se sigue leyendo para que nadie pierda su
 * tema al actualizar, y el selector lo borra la próxima vez que se usa.
 */
export const LEGACY_THEME_COOKIE = "vocero-theme";

/** El tema que de verdad está pintado en el DOM. Hoy coincide siempre con la
 *  preferencia; se nombra aparte porque quien lo lee (la vista previa del
 *  acento) pregunta por lo pintado, no por lo guardado. */
export type ResolvedTheme = ThemePreference;

/** La preferencia guardada, con la cookie nueva o, si aún no existe, la vieja. */
export function themeCookieValue(store: {
  get(name: string): { value: string } | undefined;
}): string | undefined {
  return store.get(THEME_COOKIE)?.value ?? store.get(LEGACY_THEME_COOKIE)?.value;
}
