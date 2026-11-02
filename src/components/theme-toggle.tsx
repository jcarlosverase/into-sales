"use client";

import { ThemeToggle as IntoThemeToggle, type ThemePreference } from "@into/designsystem";
import { LEGACY_THEME_COOKIE, THEME_COOKIE } from "@/lib/theme";

/**
 * Botón que alterna Claro ⇄ Oscuro (spec 1021: el del sistema de diseño), con
 * la cookie de IntoSales. Spec 1013: borra la cookie de antes al usarse.
 */
export function ThemeToggle({
  initial,
  className,
}: {
  initial: ThemePreference;
  className?: string;
}) {
  return (
    <IntoThemeToggle
      initial={initial}
      cookieName={THEME_COOKIE}
      clearCookies={[LEGACY_THEME_COOKIE]}
      className={className}
    />
  );
}
