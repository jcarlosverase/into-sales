/**
 * La marca IntoSales, de la familia "into" (azul #0070E0 y verde #33B44A;
 * manual de marca, revisión 2026 — spec 1019).
 *
 * Vive aquí, sin React, porque la usan dos mundos: los componentes (la barra
 * lateral y el login) y el servidor (la ruta del favicon). Tener la marca en
 * un solo sitio es lo que garantiza que la pestaña y la barra lateral enseñen
 * el MISMO isotipo.
 */

/**
 * El isotipo oficial de into (las flechas azul y verde), en PNG con fondo
 * transparente para que se vea igual sobre el tema claro y el oscuro.
 */
// Spec 1019: el vector del manual de 2026 (nítido en cualquier tamaño). El PNG
// de 256 px se queda para quien no lea SVG y para generar los iconos.
export const BRAND_LOGO_SRC = "/brand/into-isotipo.svg";

/**
 * Spec 1019: el favicon del manual de 2026 es el isotipo PLANO, sin sombras:
 * a 16 y 32 px las sombras se ven como manchas. El isotipo completo queda para
 * la interfaz y el ícono de la app.
 */
export const BRAND_FAVICON_SRC = "/brand/favicon.svg";

/** Azul into, el del logo. */
export const BRAND_BLUE = "#0070e0";

/**
 * Spec 1019: el azul into anterior al manual de 2026. Una marca guardada con
 * él lo tenía porque era el azul into, no por elegirlo aparte: se lee como el
 * azul de ahora (`normalizeBranding`).
 */
export const LEGACY_BRAND_BLUE = "#0081c8";

/** Verde into, el de "sales" en el wordmark. */
export const BRAND_GREEN = "#33b44a";

/**
 * ¿Esta instancia se llama IntoSales? Solo entonces se dibuja el logo: una
 * agencia que rebautizó el CRM para su cliente no debe ver las flechas de
 * otro producto en su barra lateral ni en su pestaña. El nombre por defecto
 * es "IntoSales", así que una instancia sin configurar lo ve de inmediato.
 */
export function isBrandName(name: string): boolean {
  return name.trim().toLowerCase().replace(/\s+/g, "") === "intosales";
}
