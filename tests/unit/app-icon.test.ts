import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appIconHref, parseAppIconSize } from "@/lib/app-icon";
import { DEFAULT_BRANDING, type Branding } from "@/lib/branding";

/**
 * Spec 1009: el icono de la app instalada en el teléfono, white-label como el
 * de la pestaña: el isotipo de into para IntoSales, el logo subido sobre
 * blanco o la inicial sobre el acento.
 */

const ctx = vi.hoisted(() => ({
  value: null as { organizationId: string | null; branding: Branding } | null,
}));
const media = vi.hoisted(() => ({ file: null as Buffer | null }));
vi.mock("@/server/branding", () => ({
  getBrandingContext: async () => ctx.value,
}));
vi.mock("@/server/whatsapp/media", () => ({
  readMediaFile: async () => {
    if (!media.file) throw new Error("ENOENT");
    return media.file;
  },
}));

const { GET } = await import("@/app/api/branding/app-icon/route");

const ISOTIPO = readFileSync(join(process.cwd(), "public/brand/into-isotipo.png"));

/** Ancho y alto de un PNG, leídos de su cabecera IHDR. */
function pngSize(bytes: Uint8Array): [number, number] {
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  return [view.getUint32(16), view.getUint32(20)];
}

describe("appIconHref", () => {
  it("IntoSales sin logo subido usa los PNG estáticos del isotipo", () => {
    expect(appIconHref(DEFAULT_BRANDING, 180)).toMatch(/^\/brand\/apple-touch-icon\.png\?v=/);
    expect(appIconHref(DEFAULT_BRANDING, 192)).toMatch(/^\/brand\/icon-192\.png\?v=/);
    expect(appIconHref(DEFAULT_BRANDING, 512, true)).toMatch(/^\/brand\/icon-maskable-512\.png\?v=/);
  });

  it("otra marca, o un logo subido, pasa por la ruta del icono", () => {
    const other = { ...DEFAULT_BRANDING, name: "Inmobiliaria Sol" };
    expect(appIconHref(other, 192)).toMatch(/^\/api\/branding\/app-icon\?size=192&v=/);
    expect(appIconHref(other, 512, true)).toContain("purpose=maskable");
    const uploaded = { ...DEFAULT_BRANDING, favicon: { mime: "image/png", version: 7 } };
    expect(appIconHref(uploaded, 180)).toBe("/api/branding/app-icon?size=180&v=u7");
  });

  it("un tamaño desconocido cae a 512", () => {
    expect(parseAppIconSize("192")).toBe(192);
    expect(parseAppIconSize("64")).toBe(512);
    expect(parseAppIconSize(null)).toBe(512);
  });
});

describe("GET /api/branding/app-icon", () => {
  beforeEach(() => {
    ctx.value = null;
    media.file = null;
  });

  it("IntoSales sin logo subido redirige al PNG estático", async () => {
    ctx.value = { organizationId: "org_1", branding: DEFAULT_BRANDING };
    const res = await GET(new Request("https://crm.test/api/branding/app-icon?size=192"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://crm.test/brand/icon-192.png");
  });

  it("otra marca: PNG opaco del tamaño pedido con la inicial", async () => {
    ctx.value = {
      organizationId: "org_1",
      branding: { ...DEFAULT_BRANDING, name: "Inmobiliaria Sol" },
    };
    const res = await GET(new Request("https://crm.test/api/branding/app-icon?size=180&v=x"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(pngSize(new Uint8Array(await res.arrayBuffer()))).toEqual([180, 180]);
  });

  it("logo subido: lo dibuja en un PNG de 512", async () => {
    ctx.value = {
      organizationId: "org_1",
      branding: { ...DEFAULT_BRANDING, name: "Otra", favicon: { mime: "image/png", version: 1 } },
    };
    media.file = ISOTIPO;
    const res = await GET(new Request("https://crm.test/api/branding/app-icon?size=512&purpose=maskable"));
    expect(res.status).toBe(200);
    expect(pngSize(new Uint8Array(await res.arrayBuffer()))).toEqual([512, 512]);
  });
});
