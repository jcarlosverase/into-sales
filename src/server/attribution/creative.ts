import { eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { isMockEnabled } from "@/lib/env";
import { publish } from "@/server/events/bus";
import { deleteMediaFile, saveMediaFile } from "@/server/whatsapp/media";

/**
 * 018 — La imagen del creativo, copiada al llegar.
 *
 * La URL que Meta manda en el `referral` caduca en días (el parámetro `oe` de
 * su CDN). Si no se copia en ese momento, la tarjeta del anuncio se queda sin
 * imagen para siempre. Se guarda como un adjunto más —mismo volumen, misma
 * ruta con sesión— y UNA vez por anuncio.
 *
 * Todo aquí es best-effort y corre fuera del camino del webhook: el mensaje del
 * cliente ya está en la bandeja cuando esto empieza, y nada de lo que falle
 * aquí puede tocarlo.
 */

/** El jpg de un creativo ronda 20-150 KB; más que esto no es una miniatura. */
export const CREATIVE_MAX_BYTES = 300_000;
/** Tiempo por intento, contando redirecciones y la lectura del cuerpo. */
const TIME_MS = 5_000;
const MAX_REDIRECTS = 3;
/** Espera antes del único reintento: lo justo para un tropiezo de red. */
const RETRY_MS = 1_500;

/** Sin SVG: servido desde nuestro origen, un SVG puede ejecutar scripts. */
const TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * Dominios desde los que Meta sirve los creativos. La URL llega dentro de un
 * payload externo: sin esta lista, la ingesta descargaría cualquier URL que
 * alguien le escriba, incluida la red interna del servidor (SSRF).
 */
const META_DOMAINS = [
  "fbcdn.net",
  "fbsbx.com",
  "facebook.com",
  "cdninstagram.com",
  "instagram.com",
];

function isFromMeta(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return META_DOMAINS.some((d) => h === d || h.endsWith(`.${d}`));
}

/**
 * ¿Se puede descargar esta URL? Pura para poder probarla.
 *
 * `origenMock` es el origen del wa-mock y solo se pasa con los mocks
 * habilitados, que en producción no existen (`isMockEnabled` exige
 * `NODE_ENV !== "production"`).
 */
export function creativeUrlAllowed(
  raw: string,
  originMock: string | null = null
): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.username || u.password) return false;
  if (originMock && u.origin === originMock) return true;
  if (u.protocol !== "https:") return false;
  // Meta sirve sus CDN por el 443: un puerto explícito no es de Meta.
  if (u.port !== "") return false;
  return isFromMeta(u.hostname);
}

function mockOrigin(): string | null {
  if (!isMockEnabled()) return null;
  const base = process.env.META_GRAPH_BASE_URL;
  if (!base) return null;
  try {
    return new URL(base).origin;
  } catch {
    return null;
  }
}

/**
 * Cómo acabó una descarga. `transitoria` vale la pena reintentarla (la red, un
 * 5xx, un 429, el tiempo); `permanente` no va a cambiar por insistir (host no
 * permitido, no es imagen, demasiado grande, 404).
 */
export type Download =
  | { ok: true; data: Buffer; mimeType: string }
  | { ok: false; failure: "transitoria" | "permanente" };

const PERMANENT = { ok: false, failure: "permanente" } as const;
const TRANSIENT = { ok: false, failure: "transitoria" } as const;

/** Suelta el cuerpo que no se va a leer: si no, la conexión queda ocupada. */
function discard(res: Response): void {
  void res.body?.cancel().catch(() => {});
}

/**
 * Lee el cuerpo con tope: se corta en cuanto pasa de `max`, en vez de cargar en
 * memoria lo que un servidor quiera mandar sin `content-length`.
 */
async function readCapped(
  res: Response,
  max: number
): Promise<Buffer | "grande" | "cortado"> {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        void reader.cancel().catch(() => {});
        return "grande";
      }
      partes.push(value);
    }
  } catch {
    return "cortado"; // tiempo agotado o conexión caída a media lectura
  }
  return Buffer.concat(partes);
}

/**
 * Descarga acotada: cada salto de redirección se vuelve a validar, así que un
 * host de Meta no puede mandar la petición a otro sitio.
 */
export async function downloadCreative(url: string): Promise<Download> {
  const originMock = mockOrigin();
  const signal = AbortSignal.timeout(TIME_MS);
  let actual = url;
  for (let jump = 0; jump <= MAX_REDIRECTS; jump++) {
    if (!creativeUrlAllowed(actual, originMock)) return PERMANENT;
    let res: Response;
    try {
      res = await fetch(actual, {
        redirect: "manual",
        signal,
        cache: "no-store",
        headers: { accept: "image/*" },
      });
    } catch {
      return TRANSIENT; // tiempo agotado o red caída
    }
    if (res.status >= 300 && res.status < 400) {
      const destination = res.headers.get("location");
      discard(res);
      if (!destination) return PERMANENT;
      try {
        actual = new URL(destination, actual).toString();
      } catch {
        return PERMANENT;
      }
      continue;
    }
    if (res.status >= 500 || res.status === 429) {
      discard(res);
      return TRANSIENT;
    }
    if (!res.ok) {
      discard(res);
      return PERMANENT;
    }

    const mimeType =
      res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (!TYPES[mimeType] || declared > CREATIVE_MAX_BYTES) {
      discard(res);
      return PERMANENT;
    }

    const data = await readCapped(res, CREATIVE_MAX_BYTES);
    if (data === "cortado") return TRANSIENT;
    if (data === "grande" || data.byteLength === 0) return PERMANENT;
    return { ok: true, data, mimeType };
  }
  return PERMANENT; // demasiadas redirecciones
}

/** Descarga con un reintento si el fallo fue transitorio. */
export async function downloadWithRetry(
  url: string,
  waitMs = RETRY_MS
): Promise<Download> {
  const first = await downloadCreative(url);
  if (first.ok || first.failure === "permanente") return first;
  await new Promise((r) => setTimeout(r, waitMs));
  return downloadCreative(url);
}

/** La imagen ya guardada de este anuncio, si otra conversación la trajo. */
async function existingImage(
  organizationId: string,
  sourceId: string
): Promise<string | null> {
  const db = getDb();
  const rows = await db
    .select({ assetId: schema.mediaAsset.id })
    .from(schema.adAttribution)
    .innerJoin(
      schema.mediaAsset,
      eq(schema.mediaAsset.id, schema.adAttribution.imageAssetId)
    )
    .where(
      scoped(
        schema.adAttribution.organizationId,
        organizationId,
        eq(schema.adAttribution.sourceId, sourceId),
        eq(schema.mediaAsset.organizationId, organizationId),
        eq(schema.mediaAsset.fetchStatus, "available")
      )
    )
    .limit(1);
  return rows[0]?.assetId ?? null;
}

/**
 * Deja la imagen en todas las conversaciones del anuncio que aún no la tienen:
 * la bajada que trajo la primera le sirve también a las que llegaron mientras
 * tanto.
 */
async function assignImage(
  organizationId: string,
  sourceId: string,
  assetId: string
): Promise<number> {
  const db = getDb();
  const rows = await db
    .update(schema.adAttribution)
    .set({ imageAssetId: assetId })
    .where(
      scoped(
        schema.adAttribution.organizationId,
        organizationId,
        eq(schema.adAttribution.sourceId, sourceId),
        isNull(schema.adAttribution.imageAssetId)
      )
    )
    .returning({ id: schema.adAttribution.id });
  return rows.length;
}

/**
 * Descargas en curso por anuncio. El caso normal las junta: entra el primer
 * mensaje, se lanza la copia, y el panel abierto pide el detalle en ese mismo
 * instante y lanzaría la reparación. Sin esto serían dos descargas y un
 * adjunto de más.
 */
const inProgress = new Set<string>();

/** ¿Hay ya una copia en marcha para este anuncio? */
export function downloadInProgress(organizationId: string, sourceId: string): boolean {
  return inProgress.has(`${organizationId}:${sourceId}`);
}

export async function saveCreative(input: {
  organizationId: string;
  conversationId: string;
  sourceId: string;
  imageUrl: string;
}): Promise<string | null> {
  const { organizationId, sourceId } = input;
  // La tarjeta abierta se refresca con este evento: la imagen aparece sola.
  const notify = () =>
    publish(organizationId, {
      type: "conversation.updated",
      data: { conversation: { id: input.conversationId } },
    });

  const existing = await existingImage(organizationId, sourceId);
  if (existing) {
    await assignImage(organizationId, sourceId, existing);
    notify();
    return existing;
  }

  const key = `${organizationId}:${sourceId}`;
  if (inProgress.has(key)) return null;
  inProgress.add(key);
  try {
    return await downloadAndSave(input, notify);
  } finally {
    inProgress.delete(key);
  }
}

async function downloadAndSave(
  input: { organizationId: string; sourceId: string; imageUrl: string },
  notify: () => void
): Promise<string | null> {
  const { organizationId, sourceId } = input;

  const download = await downloadWithRetry(input.imageUrl);
  if (!download.ok) {
    console.warn(
      `[atribucion] la imagen del anuncio ${sourceId} no se copió (${download.failure})`
    );
    return null;
  }

  const db = getDb();
  const assetId = newId("mediaAsset");
  const extension = TYPES[download.mimeType] ?? "jpg";
  let saved = false;
  try {
    await db.insert(schema.mediaAsset).values({
      id: assetId,
      organizationId,
      kind: "image",
      mimeType: download.mimeType,
      fileName: `anuncio-${sourceId.replace(/[^\w.-]/g, "_").slice(0, 64)}.${extension}`,
      payload: { origin: "anuncio", sourceId },
      fetchStatus: "pending",
    });
    const storagePath = await saveMediaFile(organizationId, assetId, download.data);
    saved = true;
    await db
      .update(schema.mediaAsset)
      .set({
        storagePath,
        fileSize: download.data.byteLength,
        fetchStatus: "available",
        updatedAt: new Date(),
      })
      .where(eq(schema.mediaAsset.id, assetId));
    if ((await assignImage(organizationId, sourceId, assetId)) === 0) {
      // Otra descarga (otro proceso, o una que empezó antes) ya dejó su
      // imagen: esta copia sobra y no debe quedarse ocupando el volumen.
      await deleteMediaFile(organizationId, assetId).catch(() => {});
      await db.delete(schema.mediaAsset).where(eq(schema.mediaAsset.id, assetId));
      return existingImage(organizationId, sourceId);
    }
  } catch (err) {
    // Se quita lo que se alcanzó a crear; si ya estaba asignada, la clave
    // foránea deja esas filas sin imagen (`set null`), no apuntando a nada.
    if (saved) await deleteMediaFile(organizationId, assetId).catch(() => {});
    await db
      .delete(schema.mediaAsset)
      .where(eq(schema.mediaAsset.id, assetId))
      .catch(() => {});
    console.warn(
      `[atribucion] no se pudo guardar la imagen del anuncio ${sourceId}:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }

  notify();
  return assetId;
}
