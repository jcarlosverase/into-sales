import { ImageResponse } from "next/og";
import { readMediaFile } from "@/server/whatsapp/media";
import { getBrandingContext } from "@/server/branding";
import { isBrandName } from "@/lib/brand";
import { DEFAULT_BRANDING, resolveAccentSet } from "@/lib/branding";
import { parseAppIconSize, staticAppIcon } from "@/lib/app-icon";
import { FAVICON_ASSET, faviconInitial } from "@/lib/favicon";

export const dynamic = "force-dynamic";

/**
 * Logos subidos que se pueden dibujar dentro del icono. ICO y WEBP no: el
 * dibujante de `next/og` no los lee, y esas instancias caen a la inicial.
 */
const EMBEDDABLE = new Set(["image/png", "image/jpeg", "image/svg+xml"]);

/**
 * Spec 1009: el icono de la app instalada, en PNG (iOS y Android no aceptan
 * SVG aquí) y opaco (iOS pinta de negro lo transparente). **Ruta pública**,
 * como el favicon: el teléfono lo pide antes de que haya sesión.
 *
 * `?purpose=maskable` deja más margen: los lanzadores de Android recortan el
 * icono en círculo o en gota y solo respetan el 80 % central.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const size = parseAppIconSize(url.searchParams.get("size"));
  const maskable = url.searchParams.get("purpose") === "maskable";

  const ctx = await getBrandingContext().catch(() => null);
  const branding = ctx?.branding ?? DEFAULT_BRANDING;

  const options = {
    width: size,
    height: size,
    headers: {
      "cache-control": url.searchParams.has("v")
        ? "public, max-age=31536000, immutable"
        : "public, max-age=60",
    },
  };
  const box = {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  } as const;

  let logo: string | null = null;
  if (ctx?.organizationId && branding.favicon && EMBEDDABLE.has(branding.favicon.mime)) {
    try {
      const buf = await readMediaFile(ctx.organizationId, FAVICON_ASSET);
      logo = `data:${branding.favicon.mime};base64,${Buffer.from(buf).toString("base64")}`;
    } catch {
      // Archivo perdido: se cae a la inicial, como el favicon.
    }
  }

  if (logo) {
    const side = Math.round(size * (maskable ? 0.6 : 0.8));
    return new ImageResponse(
      (
        <div style={{ ...box, background: "#ffffff" }}>
          {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
          <img src={logo} width={side} height={side} style={{ objectFit: "contain" }} />
        </div>
      ),
      options
    );
  }

  // La marca IntoSales sin logo subido tiene sus PNG estáticos.
  if (isBrandName(branding.name)) {
    return Response.redirect(new URL(staticAppIcon(size, maskable), req.url), 307);
  }

  const { accent, fg } = resolveAccentSet(branding.accent);
  return new ImageResponse(
    (
      <div
        style={{
          ...box,
          background: accent,
          color: fg,
          fontSize: Math.round(size * (maskable ? 0.42 : 0.55)),
          fontWeight: 700,
        }}
      >
        {faviconInitial(branding.name)}
      </div>
    ),
    options
  );
}
