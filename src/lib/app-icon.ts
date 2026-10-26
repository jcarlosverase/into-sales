import { isBrandName } from "./brand";
import type { Branding } from "./branding";
import { faviconCacheKey } from "./favicon";

/**
 * Spec 1009: el icono de la app instalada en el teléfono («Añadir a pantalla
 * de inicio»), white-label como el de la pestaña.
 *
 * La marca IntoSales sin logo subido usa PNG estáticos del isotipo; cualquier
 * otra instancia pasa por `/api/branding/app-icon`, que dibuja el logo subido
 * sobre blanco o la inicial sobre el acento — igual que el favicon.
 */

/** 180 = iOS; 192 y 512 = Android (manifiesto). */
export const APP_ICON_SIZES = [180, 192, 512] as const;
export type AppIconSize = (typeof APP_ICON_SIZES)[number];

/**
 * Fondo de la cabecera del CRM en el teléfono (`.nav-dark`, --bg-subtle en
 * globals.css): la barra del navegador y la de estado de la app instalada
 * toman este color para leerse como una sola franja.
 */
export const NAV_HEADER_COLOR = "#070e20";

export function parseAppIconSize(value: string | null): AppIconSize {
  const n = Number(value);
  return (APP_ICON_SIZES as readonly number[]).includes(n) ? (n as AppIconSize) : 512;
}

/** Los PNG del isotipo de into, generados una vez desde `into-isotipo.png`. */
export function staticAppIcon(size: AppIconSize, maskable: boolean): string {
  if (size === 180) return "/brand/apple-touch-icon.png";
  if (maskable) return "/brand/icon-maskable-512.png";
  return `/brand/icon-${size}.png`;
}

/** URL del icono de la app para esta marca. */
export function appIconHref(
  branding: Pick<Branding, "name" | "accent" | "favicon">,
  size: AppIconSize,
  maskable = false
): string {
  const v = faviconCacheKey(branding);
  if (!branding.favicon && isBrandName(branding.name)) {
    return `${staticAppIcon(size, maskable)}?v=${v}`;
  }
  const purpose = maskable ? "&purpose=maskable" : "";
  return `/api/branding/app-icon?size=${size}${purpose}&v=${v}`;
}
