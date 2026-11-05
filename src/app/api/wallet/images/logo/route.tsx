import { readableInk } from "@/lib/branding";
import { getBrandingContext } from "@/server/branding";
import { stampCardDisabledResponse, stampCardEnabled } from "@/server/stamp-card/flag";
import { brandLogoDataUri, renderTile } from "@/server/stamp-card/images";

export const dynamic = "force-dynamic";

/**
 * 1023, D11 — El logo de la tarjeta en Google Wallet (660 × 660). Pública,
 * como el icono de la app: la descarga Google, sin sesión. `c` es el color
 * del programa para la inicial cuando no hay logo subido; `v`, la versión.
 */
export async function GET(req: Request) {
  if (!stampCardEnabled()) return stampCardDisabledResponse();
  const raw = new URL(req.url).searchParams.get("c") ?? "";
  const color = /^[0-9a-fA-F]{6}$/.test(raw) ? `#${raw.toLowerCase()}` : "#0070e0";
  const ctx = await getBrandingContext().catch(() => null);
  const logo = ctx?.organizationId ? await brandLogoDataUri(ctx.organizationId, ctx.branding) : null;
  const png = await renderTile(660, ctx?.branding.name ?? "", color, readableInk(color), logo);
  return new Response(new Uint8Array(png), {
    headers: { "content-type": "image/png", "cache-control": "public, max-age=3600" },
  });
}
