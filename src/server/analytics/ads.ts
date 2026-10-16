import { and, eq, gte, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  comparable,
  rate,
  type AdRowDto,
  type AdsBlockDto,
  type SourceKey,
  type SourceRowDto,
} from "@/lib/analytics";
import { SOURCE_LABELS, SOURCE_VALUES } from "@/server/contact-source";
import type { ResolvedPeriod } from "@/server/analytics/period";
import {
  effectiveSourceExpr,
  firstAttributionIdExpr,
  notLabContact,
} from "@/server/analytics/shared";

/**
 * 019 — De dónde llegan: por origen y por anuncio, SOLO en conteos.
 *
 * Sin gasto ni costo ni retorno (spec 019, D1-D2): lo único que el raíz sabe
 * de un anuncio es lo que Meta manda en el `referral` del webhook y la 018 ya
 * guarda. Contar conversaciones, prospectos y ventas no pide la API de
 * Marketing ni un conector.
 *
 * Tres conteos por fila, con significados que no se mezclan:
 *  - conversaciones: las que EMPEZARON en el periodo;
 *  - prospectos: los leads creados en el periodo;
 *  - ventas: de esos prospectos, los que hoy están en Ganado. Es una cohorte a
 *    propósito: así «ventas ÷ prospectos» es la conversión de la fila y no
 *    puede pasar de 100 %.
 */

const SOURCES: readonly SourceKey[] = [...SOURCE_VALUES, "desconocida"];

/** Cuántas filas enseña la tabla por anuncio: más no se lee en una pantalla. */
export const MAX_ADS = 50;

export async function adsBlock(
  organizationId: string,
  period: ResolvedPeriod
): Promise<AdsBlockDto> {
  const [convsBySource, leadsBySource, convsByAd, leadsByAd, previous] =
    await Promise.all([
      conversationsBySource(organizationId, period.start, period.end),
      prospectsBySource(organizationId, period.start, period.end),
      conversationsByAd(organizationId, period.start, period.end),
      prospectsByAd(organizationId, period.start, period.end),
      countConversations(organizationId, period.previousStart, period.previousEnd),
    ]);

  const sources = joinSources(convsBySource, leadsBySource);
  const ads = joinAds(convsByAd, leadsByAd);
  const conversations = sources.reduce((a, s) => a + s.conversations, 0);
  const fromAd = sources.find((s) => s.value === "anuncio")?.conversations ?? 0;
  const prospects = sources.reduce((a, s) => a + s.leads, 0);

  return {
    period: period.dto,
    conversations: comparable(conversations, previous),
    adShare: rate(fromAd, conversations),
    sources,
    ads,
    empty: conversations === 0 && prospects === 0,
  };
}

type Count = { key: string | null; n: number };
type CountLeads = { key: string | null; leads: number; won: number };

/** Conversaciones reales que empezaron en el rango, por el origen del contacto. */
async function conversationsBySource(
  organizationId: string,
  start: Date,
  end: Date
): Promise<Count[]> {
  return getDb()
    .select({
      key: effectiveSourceExpr(
        schema.conversation.organizationId,
        schema.conversation.contactId,
        schema.contact.source
      ),
      n: sql<number>`count(*)::int`,
    })
    .from(schema.conversation)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.isTest, false),
        gte(schema.conversation.createdAt, start),
        lt(schema.conversation.createdAt, end)
      )
    )
    .groupBy(sql`1`);
}

async function countConversations(
  organizationId: string,
  start: Date,
  end: Date
): Promise<number> {
  const rows = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.isTest, false),
        gte(schema.conversation.createdAt, start),
        lt(schema.conversation.createdAt, end)
      )
    );
  return rows[0]?.n ?? 0;
}

/** Prospectos creados en el rango y cuántos de ellos están hoy en Ganado. */
async function prospectsBySource(
  organizationId: string,
  start: Date,
  end: Date
): Promise<CountLeads[]> {
  return getDb()
    .select({
      key: effectiveSourceExpr(
        schema.lead.organizationId,
        schema.lead.contactId,
        schema.contact.source
      ),
      leads: sql<number>`count(*)::int`,
      won: sql<number>`count(*) filter (where ${schema.pipelineStage.kind} = 'won')::int`,
    })
    .from(schema.lead)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.lead.contactId))
    .innerJoin(schema.pipelineStage, eq(schema.pipelineStage.id, schema.lead.stageId))
    .where(
      scoped(
        schema.lead.organizationId,
        organizationId,
        gte(schema.lead.createdAt, start),
        lt(schema.lead.createdAt, end),
        notLabContact(schema.lead.contactId)
      )
    )
    .groupBy(sql`1`);
}

/** Las filas por anuncio: la llave es el `source_id`, o la fila si no hay. */
const key = sql<string>`coalesce(${schema.adAttribution.sourceId}, ${schema.adAttribution.id})`;
const metadata = {
  sourceId: sql<string | null>`max(${schema.adAttribution.sourceId})`,
  sourceType: sql<string | null>`max(${schema.adAttribution.sourceType})`,
  headline: sql<string | null>`max(${schema.adAttribution.headline})`,
  imageAssetId: sql<string | null>`max(${schema.adAttribution.imageAssetId})`,
  lastAt: sql<number>`extract(epoch from max(${schema.adAttribution.createdAt}))::float`,
};

type Metadata = {
  key: string;
  sourceId: string | null;
  sourceType: string | null;
  headline: string | null;
  imageAssetId: string | null;
  lastAt: number;
};

/**
 * Conversaciones reales que empezaron en el rango, por el anuncio que las
 * abrió. Cada fila de `ad_attribution` es de UNA conversación (el primer
 * anuncio gana, 016), así que no hay doble conteo.
 */
async function conversationsByAd(
  organizationId: string,
  start: Date,
  end: Date
): Promise<(Metadata & { conversations: number })[]> {
  return getDb()
    .select({
      key: key,
      ...metadata,
      conversations: sql<number>`count(*)::int`,
    })
    .from(schema.adAttribution)
    .innerJoin(
      schema.conversation,
      and(
        eq(schema.conversation.id, schema.adAttribution.conversationId),
        eq(schema.conversation.isTest, false)
      )
    )
    .where(
      scoped(
        schema.adAttribution.organizationId,
        organizationId,
        gte(schema.conversation.createdAt, start),
        lt(schema.conversation.createdAt, end)
      )
    )
    .groupBy(key);
}

/**
 * Prospectos del periodo por el anuncio que los trajo, y cuántos están hoy en
 * Ganado.
 *
 * Cada contacto cuenta UNA vez, con su PRIMER anuncio (el que enseña su
 * ficha): unir contra todas sus filas lo contaría dos veces si escribió desde
 * dos conversaciones.
 */
async function prospectsByAd(
  organizationId: string,
  start: Date,
  end: Date
): Promise<(Metadata & { leads: number; won: number })[]> {
  return getDb()
    .select({
      key: key,
      ...metadata,
      leads: sql<number>`count(*)::int`,
      won: sql<number>`count(*) filter (where ${schema.pipelineStage.kind} = 'won')::int`,
    })
    .from(schema.lead)
    .innerJoin(schema.pipelineStage, eq(schema.pipelineStage.id, schema.lead.stageId))
    .innerJoin(
      schema.adAttribution,
      and(
        eq(schema.adAttribution.organizationId, schema.lead.organizationId),
        eq(schema.adAttribution.contactId, schema.lead.contactId),
        sql`${schema.adAttribution.id} = ${firstAttributionIdExpr(
          schema.lead.organizationId,
          schema.lead.contactId
        )}`
      )
    )
    .where(
      scoped(
        schema.lead.organizationId,
        organizationId,
        gte(schema.lead.createdAt, start),
        lt(schema.lead.createdAt, end),
        notLabContact(schema.lead.contactId)
      )
    )
    .groupBy(key);
}

/** Las seis fuentes en su orden fijo, solo las que tienen algo. */
export function joinSources(convs: Count[], leads: CountLeads[]): SourceRowDto[] {
  const conv = new Map(convs.map((c) => [c.key ?? "desconocida", c.n]));
  const lead = new Map(leads.map((l) => [l.key ?? "desconocida", l]));

  return SOURCES.map((value) => {
    const l = lead.get(value);
    const won = l?.won ?? 0;
    const leadsN = l?.leads ?? 0;
    return {
      value,
      label: SOURCE_LABELS[value],
      conversations: conv.get(value) ?? 0,
      leads: leadsN,
      won,
      winRate: rate(won, leadsN),
    };
  }).filter((f) => f.conversations > 0 || f.leads > 0);
}

/**
 * Une las dos vistas por anuncio. Más conversaciones primero; a igualdad, más
 * prospectos, y luego el anuncio que trajo a alguien más recientemente, que
 * es el que el dueño está mirando.
 */
export function joinAds(
  convs: (Metadata & { conversations: number })[],
  leads: (Metadata & { leads: number; won: number })[]
): AdRowDto[] {
  const rowsValue = new Map<string, AdRowDto & { lastAt: number }>();
  const base = (m: Metadata) => ({
    key: m.key,
    sourceId: m.sourceId,
    sourceType: m.sourceType,
    headline: m.headline,
    imageAssetId: m.imageAssetId,
    lastAt: m.lastAt,
    conversations: 0,
    leads: 0,
    won: 0,
    winRate: rate(0, 0),
  });

  for (const c of convs) {
    rowsValue.set(c.key, { ...base(c), conversations: c.conversations });
  }
  for (const l of leads) {
    const row = rowsValue.get(l.key) ?? base(l);
    row.leads = l.leads;
    row.won = l.won;
    row.winRate = rate(l.won, l.leads);
    // La imagen se descarga una vez por anuncio y puede llegar después: la que
    // haya, de cualquiera de las dos vistas.
    row.imageAssetId ??= l.imageAssetId;
    row.headline ??= l.headline;
    if (l.lastAt > row.lastAt) row.lastAt = l.lastAt;
    rowsValue.set(l.key, row);
  }

  return [...rowsValue.values()]
    .sort(
      (a, b) =>
        b.conversations - a.conversations ||
        b.leads - a.leads ||
        b.lastAt - a.lastAt
    )
    .slice(0, MAX_ADS)
    .map(({ lastAt: _lastAt, ...row }) => row);
}
