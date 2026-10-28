import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Barlow, IBM_Plex_Mono, Instrument_Serif } from "next/font/google";
import { appIconHref, NAV_HEADER_COLOR } from "@/lib/app-icon";
import { accentCssVariables, DEFAULT_BRANDING } from "@/lib/branding";
import { faviconHref } from "@/lib/favicon";
import { normalizeThemePreference, THEME_COOKIE } from "@/lib/theme";
import { getBranding } from "@/server/branding";
import "./globals.css";

// Las tres voces de la marca. Barlow sustituye a DIN Pro, la letra de into,
// mientras no haya licencia web de DIN Pro. next/font las descarga en BUILD y
// las sirve self-hosted (sin CDN en runtime: soberanía).
const barlow = Barlow({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans",
  display: "swap",
});
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getBranding().catch(() => DEFAULT_BRANDING);
  return {
    title: `${branding.name} — CRM de WhatsApp`,
    description: "IntoSales: CRM de WhatsApp con agente de IA, de into",
    // El `?v=` cambia con la marca: los navegadores guardan el favicon con una
    // insistencia notable y, sin eso, el logo nuevo tarda días en aparecer.
    // Spec 1009: iOS ignora los iconos del manifiesto y toma este (180 px,
    // opaco) para la pantalla de inicio.
    icons: { icon: faviconHref(branding), apple: appIconHref(branding, 180) },
    // Spec 1009: abierta desde la pantalla de inicio de iOS, a pantalla
    // completa y con el nombre de la marca bajo el icono.
    appleWebApp: { capable: true, title: branding.name, statusBarStyle: "black" },
    formatDetection: { telephone: false },
  };
}

// Spec 1009: en el teléfono el CRM abre bajo su cabecera azul marino, así que
// la barra del navegador y la de estado de la app instalada toman ese color.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: NAV_HEADER_COLOR,
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const branding = await getBranding().catch(() => DEFAULT_BRANDING);
  const theme = normalizeThemePreference(
    (await cookies()).get(THEME_COOKIE)?.value
  );
  return (
    <html
      lang="es"
      className={`${barlow.variable} ${instrumentSerif.variable} ${plexMono.variable}`}
      // La preferencia siempre es explícita: el tema viaja resuelto en el HTML
      // del servidor, así que no hay divergencia con el cliente ni parpadeo.
      data-theme={theme}
    >
      <head>
        {/* Acento white-label inyectado en SSR: sin flash de tema */}
        <style
          dangerouslySetInnerHTML={{ __html: accentCssVariables(branding.accent) }}
        />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
