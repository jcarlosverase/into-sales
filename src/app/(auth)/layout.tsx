import { AuthScreen } from "@into/designsystem";
import { DEFAULT_BRANDING } from "@/lib/branding";
import { getBranding } from "@/server/branding";
import { BrandLogo } from "@/components/brand-mark";
import { isBrandName, PRODUCT_TAGLINE } from "@/lib/brand";

/**
 * Pantalla de entrada (spec 1021: `AuthScreen` del sistema de diseño, la misma
 * de into-central): papel frío, rejilla difuminada y dos resplandores detrás
 * del formulario, el logo y una línea debajo.
 *
 * Spec 1020: con la marca IntoSales, esa línea es su lema («Vende más por
 * WhatsApp.», manual de marca 2026). Una instancia rebautizada (white-label)
 * conserva la descripción neutra: el lema es de IntoSales, no de su negocio.
 */
export default async function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const branding = await getBranding().catch(() => DEFAULT_BRANDING);
  return (
    <AuthScreen
      logo={<BrandLogo branding={branding} size="lg" />}
      title={branding.name}
      tagline={isBrandName(branding.name) ? PRODUCT_TAGLINE : "CRM de WhatsApp con agente de IA"}
    >
      {children}
    </AuthScreen>
  );
}
