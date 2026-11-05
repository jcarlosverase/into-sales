import { ImageResponse } from "next/og";
import type { Branding } from "@/lib/branding";
import { faviconInitial, FAVICON_ASSET } from "@/lib/favicon";
import { readMediaFile } from "@/server/whatsapp/media";
import type { PassFiles } from "./pkpass";

/**
 * 1023, D11 — Las imágenes del pase, dibujadas por el CRM con `next/og`
 * (como el icono de la app): el logo de la instancia (white-label) y la
 * franja con los círculos de los sellos. Nada del cliente del negocio.
 */

/** Logos que el dibujante de `next/og` sabe leer (igual que el icono de la app). */
const EMBEDDABLE = new Set(["image/png", "image/jpeg", "image/svg+xml"]);

/** El logo subido de la instancia como data URI, o null para dibujar la inicial. */
export async function brandLogoDataUri(organizationId: string, branding: Pick<Branding, "favicon">): Promise<string | null> {
  if (!branding.favicon || !EMBEDDABLE.has(branding.favicon.mime)) return null;
  try {
    const buf = await readMediaFile(organizationId, FAVICON_ASSET);
    return `data:${branding.favicon.mime};base64,${Buffer.from(buf).toString("base64")}`;
  } catch {
    return null;
  }
}

async function png(element: React.ReactElement, width: number, height: number): Promise<Buffer> {
  const res = new ImageResponse(element, { width, height });
  return Buffer.from(await res.arrayBuffer());
}

/** Un mosaico cuadrado con el logo sobre blanco, o la inicial sobre el color del programa. */
function tile(size: number, name: string, color: string, ink: string, logo: string | null): React.ReactElement {
  const box = { width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" } as const;
  if (logo) {
    const side = Math.round(size * 0.8);
    return (
      <div style={{ ...box, background: "#ffffff", borderRadius: Math.round(size * 0.22) }}>
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
        <img src={logo} width={side} height={side} style={{ objectFit: "contain" }} />
      </div>
    );
  }
  return (
    <div
      style={{
        ...box,
        background: color,
        color: ink,
        fontSize: Math.round(size * 0.6),
        fontWeight: 700,
        borderRadius: Math.round(size * 0.22),
      }}
    >
      {faviconInitial(name)}
    </div>
  );
}

export type StripInput = { stamps: number; stampsRequired: number; color: string; ink: string };

/** La franja: un círculo por sello, llenos los que ya tiene. Hasta 10 por fila. */
export function renderStrip(input: StripInput, width: number, height: number): Promise<Buffer> {
  const required = Math.max(1, input.stampsRequired);
  const shown = Math.min(input.stamps, required);
  const columns = Math.min(10, required);
  const rows = Math.ceil(required / columns);
  const pad = Math.round(height * 0.12);
  const cell = Math.min((width - pad * 2) / columns, (height - pad * 2) / rows);
  const diameter = Math.floor(cell * 0.78);
  const ring = Math.max(2, Math.round(diameter * 0.09));
  return png(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: input.color,
      }}
    >
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} style={{ display: "flex" }}>
          {Array.from({ length: Math.min(columns, required - r * columns) }, (_, c) => {
            const on = r * columns + c < shown;
            return (
              <div key={c} style={{ display: "flex", width: cell, height: cell, alignItems: "center", justifyContent: "center" }}>
                <div
                  style={{
                    width: diameter,
                    height: diameter,
                    borderRadius: diameter,
                    border: `${ring}px solid ${input.ink}`,
                    background: on ? input.ink : "transparent",
                    opacity: on ? 1 : 0.55,
                    display: "flex",
                  }}
                />
              </div>
            );
          })}
        </div>
      ))}
    </div>,
    width,
    height
  );
}

/** El mosaico del logo en PNG, por ejemplo para la clase de Google (corte 3). */
export function renderTile(size: number, name: string, color: string, ink: string, logo: string | null): Promise<Buffer> {
  return png(tile(size, name, color, ink, logo), size, size);
}

/**
 * Las imágenes del pase de Apple en @1x, @2x y @3x: `icon` (29 pt, el que
 * sale en avisos), `logo` (50 pt de alto, junto al nombre) y `strip`
 * (375 × 123 pt, los sellos).
 */
export async function applePassImages(input: {
  name: string;
  color: string;
  ink: string;
  logo: string | null;
  stamps: number;
  stampsRequired: number;
}): Promise<PassFiles> {
  const files: PassFiles = {};
  const scales: [suffix: string, k: number][] = [
    ["", 1],
    ["@2x", 2],
    ["@3x", 3],
  ];
  await Promise.all(
    scales.flatMap(([suffix, k]) => [
      renderTile(29 * k, input.name, input.color, input.ink, input.logo).then((b) => (files[`icon${suffix}.png`] = b)),
      renderTile(50 * k, input.name, input.color, input.ink, input.logo).then((b) => (files[`logo${suffix}.png`] = b)),
      renderStrip(input, 375 * k, 123 * k).then((b) => (files[`strip${suffix}.png`] = b)),
    ])
  );
  return files;
}
