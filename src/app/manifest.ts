import type { MetadataRoute } from "next";
import { appIconHref, NAV_HEADER_COLOR } from "@/lib/app-icon";
import { DEFAULT_BRANDING } from "@/lib/branding";
import { getBranding } from "@/server/branding";

export const dynamic = "force-dynamic";

/**
 * Spec 1009: el CRM se instala como app desde el navegador del teléfono
 * («Añadir a pantalla de inicio» / «Instalar app»), con el nombre y el icono
 * de la marca de esta instancia. Android lee este manifiesto; iOS toma su
 * icono (`icons.apple`) y lo demás (`appleWebApp`) del layout raíz.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const branding = await getBranding().catch(() => DEFAULT_BRANDING);
  return {
    id: "/",
    name: branding.name,
    short_name: branding.name,
    description: "CRM de WhatsApp con agente de IA",
    lang: "es",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: NAV_HEADER_COLOR,
    icons: [
      { src: appIconHref(branding, 192), sizes: "192x192", type: "image/png", purpose: "any" },
      { src: appIconHref(branding, 512), sizes: "512x512", type: "image/png", purpose: "any" },
      { src: appIconHref(branding, 512, true), sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
