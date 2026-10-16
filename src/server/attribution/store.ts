import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import type { AdDto } from "@/lib/types";
import { downloadInProgress, saveCreative } from "@/server/attribution/creative";
import { attributionEnabled } from "@/server/attribution/flag";
import {
  whatsappAd,
  withoutClickIdentifier,
  type OriginAd,
} from "@/server/attribution/referral";

/**
 * 016 + 018 — De qué anuncio vino una conversación.
 *
 * El `referral` solo llega cuando el mensaje viene de un anuncio
 * Click-to-WhatsApp, y normalmente solo en el PRIMER mensaje de la
 * conversación. Desde 018 se guarda siempre, para que la bandeja diga de qué
 * anuncio llegó cada persona; su `ctwa_clid` —la llave para reportarle a Meta
 * (016)— solo con la bandera `ATRIBUCION` encendida.
 */

/**
 * Lo que de verdad se guarda de un anuncio. Sin la bandera, sin identificador
 * de clic (018, D2). Aparte y puro para poder probar las dos posiciones.
 */
export function adToSave(
  ad: OriginAd,
  attributes: boolean = attributionEnabled()
): OriginAd {
  return attributes ? ad : withoutClickIdentifier(ad);
}

/**
 * El primer anuncio gana. `ON CONFLICT DO NOTHING` sobre el UNIQUE de
 * (organización, conversación) —y no un "consulta y luego inserta"— porque Meta
 * reintenta el webhook y dos entregas simultáneas ganarían la carrera las dos
 * (Constitución IV).
 */
export async function registerOriginAd(input: {
  organizationId: string;
  contactId: string;
  conversationId: string;
  ad: OriginAd;
}): Promise<void> {
  const db = getDb();
  const a = adToSave(input.ad);
  const created = await db
    .insert(schema.adAttribution)
    .values({
      id: newId("adAttribution"),
      organizationId: input.organizationId,
      contactId: input.contactId,
      conversationId: input.conversationId,
      ctwaClid: a.ctwaClid,
      sourceId: a.sourceId,
      sourceType: a.sourceType,
      sourceUrl: a.sourceUrl,
      headline: a.headline,
      body: a.body,
      mediaType: a.mediaType,
      raw: a.raw,
    })
    .onConflictDoNothing({
      target: [
        schema.adAttribution.organizationId,
        schema.adAttribution.conversationId,
      ],
    })
    .returning({ id: schema.adAttribution.id });

  // Solo la fila nueva baja imagen: una reentrega no dispara otra descarga.
  if (created[0] && a.sourceId && a.imageUrl) {
    const { organizationId, conversationId } = input;
    const sourceId = a.sourceId;
    const imageUrl = a.imageUrl;
    void saveCreative({ organizationId, conversationId, sourceId, imageUrl }).catch(
      (err) =>
        console.warn(
          `[atribucion] imagen del anuncio ${sourceId} no guardada:`,
          err instanceof Error ? err.message : err
        )
    );
  }
}

/** Usada por la Conversions API (016): el anuncio de UNA conversación. */
export async function getAttributionForConversation(
  organizationId: string,
  conversationId: string
) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.adAttribution)
    .where(
      and(
        eq(schema.adAttribution.organizationId, organizationId),
        eq(schema.adAttribution.conversationId, conversationId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

/** La fila del anuncio de origen de un contacto: el primero que lo trajo. */
async function firstContactRow(organizationId: string, contactId: string) {
  const db = getDb();
  const rowsValue = await db
    .select()
    .from(schema.adAttribution)
    .where(
      scoped(
        schema.adAttribution.organizationId,
        organizationId,
        eq(schema.adAttribution.contactId, contactId)
      )
    )
    .orderBy(asc(schema.adAttribution.createdAt), asc(schema.adAttribution.id))
    .limit(1);
  return rowsValue[0] ?? null;
}

export async function contactAd(
  organizationId: string,
  contactId: string
): Promise<AdDto | null> {
  const row = await firstContactRow(organizationId, contactId);
  return row ? serializeAd(row) : null;
}

/** Como mucho un intento de reparación por anuncio en esta ventana. */
export const REPAIR_EACH_MS = 10 * 60_000;

/**
 * El freno de la reparación, aparte para poder probarlo sin base: ¿toca
 * intentar esta clave ahora? Si sí, deja anotado el intento. Las claves viejas
 * se purgan para que el mapa no crezca sin fin.
 */
export function createBrake(windowMs = REPAIR_EACH_MS, maxKeys = 5_000) {
  const ultimos = new Map<string, number>();
  return {
    tryKey(key: string, now = Date.now()): boolean {
      const previous = ultimos.get(key);
      if (previous !== undefined && now - previous < windowMs) return false;
      ultimos.set(key, now);
      if (ultimos.size > maxKeys) {
        for (const [k, t] of ultimos) {
          if (now - t >= windowMs) ultimos.delete(k);
        }
      }
      return true;
    },
    get keys() {
      return ultimos.size;
    },
  };
}

const repairBrake = createBrake();

/**
 * Si la imagen no se pudo copiar al llegar (la red tropezó más de una vez, o
 * la fila es de antes de 018), se vuelve a intentar cuando alguien abre el
 * contacto: la URL de Meta suele seguir viva unos días, y es justo cuando la
 * tarjeta se va a ver.
 *
 * No bloquea la lectura, y va con freno: el panel pide el detalle en cada
 * evento de la bandeja, y sin él una URL que ya no sirve se pediría a Meta una
 * y otra vez.
 */
export function repairImageIfMissing(organizationId: string, contactId: string): void {
  void (async () => {
    const row = await firstContactRow(organizationId, contactId);
    if (!row || row.imageAssetId || !row.sourceId) return;
    // La copia de la llegada sigue en marcha: no es un fallo, y gastar aquí el
    // intento de la ventana dejaría sin reparar lo que de verdad falle.
    if (downloadInProgress(organizationId, row.sourceId)) return;
    if (!repairBrake.tryKey(`${organizationId}:${row.sourceId}`)) return;

    // El `raw` conserva las claves de imagen (también el de las filas de 016).
    const ad = whatsappAd(row.raw);
    if (!ad?.imageUrl) return;
    await saveCreative({
      organizationId,
      conversationId: row.conversationId,
      sourceId: row.sourceId,
      imageUrl: ad.imageUrl,
    });
  })().catch((err) =>
    console.warn(
      `[atribucion] reparación de imagen del contacto ${contactId} falló:`,
      err instanceof Error ? err.message : err
    )
  );
}

/**
 * Lo que ve la bandeja. El `ctwa_clid` NO viaja: es el identificador del clic
 * para la Conversions API, y a quien atiende solo le sirve saber si existe. Y
 * ni eso sin la bandera: «Meta identificó el clic» solo tiene sentido en una
 * instancia que atribuye (018, D2), aunque la fila sea de cuando lo hacía.
 */
export function serializeAd(
  row: typeof schema.adAttribution.$inferSelect,
  attributes: boolean = attributionEnabled()
): AdDto {
  return {
    sourceId: row.sourceId,
    sourceType: row.sourceType,
    // El enlace va a un `href`: solo https, aunque la ingesta ya filtró.
    sourceUrl: row.sourceUrl?.startsWith("https://") ? row.sourceUrl : null,
    headline: row.headline,
    body: row.body,
    mediaType: row.mediaType,
    imageAssetId: row.imageAssetId,
    hasCtwaClid: attributes && row.ctwaClid !== null,
    capturedAt: row.createdAt.toISOString(),
  };
}
