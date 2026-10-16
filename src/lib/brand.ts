/**
 * La marca IntoSales, de la familia "into" (azul #0081C8 y verde #33B44A).
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
export const BRAND_LOGO_SRC = "/brand/into-isotipo.png";

/** Azul into, el del logo. */
export const BRAND_BLUE = "#0081c8";

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
