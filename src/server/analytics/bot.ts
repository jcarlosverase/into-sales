import { eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  HANDOFF_LABEL,
  rate,
  type BotBlockDto,
  type LabeledCountDto,
  type SessionsDto,
} from "@/lib/analytics";
import { agendaEnabled } from "@/server/agenda/flag";
import { median, type ResolvedPeriod } from "@/server/analytics/period";
import { notLabContact } from "@/server/analytics/shared";

/**
 * 019 — El trabajo del agente.
 *
 * Se quedan las medidas que valen para cualquier negocio —contestó, cuánto
 * tardó, cuántas veces pasó a un humano, cómo salieron las citas—. Todas miran
 * la MISMA cohorte: las conversaciones que empezaron en el periodo. Así una
 * tasa no puede pasar de 100 % por contar en el numerador escalamientos de
 * conversaciones viejas que el denominador no tiene.
 *
 * Solo conversaciones reales: el Laboratorio escala a propósito (su persona
 * «pide humano») y contesta siempre; contarlo haría ver al agente mejor y peor
 * de lo que es.
 */
export async function botBlock(
  organizationId: string,
  period: ResolvedPeriod,
  agenda: boolean = agendaEnabled()
): Promise<BotBlockDto> {
  const { start, end } = period;

  const [counts, first, handoffs, sessions, qualification] = await Promise.all([
    cohortCounts(organizationId, start, end),
    medianFirstResponse(organizationId, start, end),
    escalations(organizationId, start, end),
    // Sin la bandera no hay agenda, y sin agenda no hay citas que contar: ni
    // siquiera se consulta (spec 019, D4).
    agenda ? periodSessions(organizationId, start, end) : Promise.resolve(null),
    qualificationCoverage(organizationId, start, end),
  ]);

  const escalados = handoffs.reduce((a, h) => a + h.count, 0);

  return {
    period: period.dto,
    conversations: counts.total,
    aiReplyRate: rate(counts.agentAnswered, counts.withInbound),
    firstResponseSeconds: first.median,
    firstResponseSample: first.sample,
    handoffs,
    handoffRate: rate(escalados, counts.total),
    sessions: sessions,
    qualificationCoverage: qualification,
    empty: counts.total === 0 && (sessions?.booked ?? 0) === 0,
  };
}

/**
 * La conversación de afuera, para las subconsultas correlacionadas, con su
 * nombre de tabla ESCRITO. En la lista de SELECT de una consulta de una sola
 * tabla, drizzle le quita la tabla a toda columna interpolada: `${id}` saldría
 * como `"id"`, y dentro de `from "message" m` eso es `m.id` — la subconsulta se
 * compararía consigo misma y la primera respuesta saldría siempre vacía.
 */
const conversationId = sql.raw(`"conversation"."id"`);

/** Las conversaciones reales que empezaron en el rango. */
function cohort(organizationId: string, start: Date, end: Date) {
  return scoped(
    schema.conversation.organizationId,
    organizationId,
    eq(schema.conversation.isTest, false),
    gte(schema.conversation.createdAt, start),
    lt(schema.conversation.createdAt, end)
  );
}

/**
 * Cuántas son, en cuántas escribió el cliente y en cuántas de ésas contestó el
 * agente. «El agente» es todo saliente con origen IA: el in-process y un
 * cerebro externo por `/api/bot/messages` escriben igual.
 */
async function cohortCounts(organizationId: string, start: Date, end: Date) {
  const inbound = sql`exists (select 1 from "message" mi where mi."conversation_id" = ${conversationId} and mi."direction" = 'in')`;
  const fromAgent = sql`exists (select 1 from "message" mo where mo."conversation_id" = ${conversationId} and mo."direction" = 'out' and mo."origin" = 'ai')`;
  const rows = await getDb()
    .select({
      total: sql<number>`count(*)::int`,
      withInbound: sql<number>`count(*) filter (where ${inbound})::int`,
      agentAnswered: sql<number>`count(*) filter (where ${inbound} and ${fromAgent})::int`,
    })
    .from(schema.conversation)
    .where(cohort(organizationId, start, end));
  return {
    total: rows[0]?.total ?? 0,
    withInbound: rows[0]?.withInbound ?? 0,
    agentAnswered: rows[0]?.agentAnswered ?? 0,
  };
}

/**
 * Mediana —no promedio— del tiempo hasta la primera respuesta del agente.
 *
 * Una conversación que se quedó colgada ocho horas arrastraría el promedio y
 * haría ver lento a un agente que contesta en segundos.
 */
async function medianFirstResponse(
  organizationId: string,
  start: Date,
  end: Date
): Promise<{ median: number | null; sample: number }> {
  const firstInbound = sql`(select min(m1."created_at") from "message" m1
    where m1."conversation_id" = ${conversationId} and m1."direction" = 'in')`;
  const rows = await getDb()
    .select({
      seconds: sql<number | null>`extract(epoch from (
        (select min(m2."created_at") from "message" m2
          where m2."conversation_id" = ${conversationId}
            and m2."direction" = 'out' and m2."origin" = 'ai'
            and m2."created_at" > ${firstInbound})
        - ${firstInbound}
      ))`,
    })
    .from(schema.conversation)
    .where(cohort(organizationId, start, end));

  const values = rows
    .map((r) => (r.seconds === null ? null : Number(r.seconds)))
    .filter((v): v is number => v !== null && v >= 0);

  return { median: median(values), sample: values.length };
}

/** De la cohorte, las que hoy están en manos de un humano, por motivo. */
async function escalations(
  organizationId: string,
  start: Date,
  end: Date
): Promise<LabeledCountDto[]> {
  const rows = await getDb()
    .select({
      reason: schema.conversation.handoffReason,
      n: sql<number>`count(*)::int`,
    })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.isTest, false),
        gte(schema.conversation.createdAt, start),
        lt(schema.conversation.createdAt, end),
        isNotNull(schema.conversation.handoffAt)
      )
    )
    .groupBy(schema.conversation.handoffReason);

  return rows
    .map((r) => {
      const key = r.reason ?? "sin_motivo";
      return {
        key,
        label: HANDOFF_LABEL[key] ?? "Sin motivo registrado",
        count: r.n,
      };
    })
    .sort((a, b) => b.count - a.count);
}

/** Citas del periodo por desenlace. Las de prueba no son citas. */
async function periodSessions(
  organizationId: string,
  start: Date,
  end: Date
): Promise<SessionsDto> {
  const rows = await getDb()
    .select({ status: schema.booking.status, n: sql<number>`count(*)::int` })
    .from(schema.booking)
    .where(
      scoped(
        schema.booking.organizationId,
        organizationId,
        eq(schema.booking.kind, "session"),
        eq(schema.booking.isTest, false),
        gte(schema.booking.scheduledAt, start),
        lt(schema.booking.scheduledAt, end)
      )
    )
    .groupBy(schema.booking.status);

  const n = (s: string) => rows.find((r) => r.status === s)?.n ?? 0;
  const done = n("realizada");
  const noShow = n("no_show");
  return {
    booked: rows.reduce((a, r) => a + r.n, 0),
    done,
    noShow,
    cancelled: n("cancelada"),
    // Contra las que LLEGARON a su hora, no contra todas: una cita cancelada
    // con aviso no es un plantón, y meterla en el denominador haría ver mal a
    // un negocio cuyos clientes avisan.
    showRate: rate(done, done + noShow),
  };
}

/**
 * Qué parte de los contactos nuevos tiene ficha.
 *
 * Devuelve `null` cuando NINGÚN contacto real tiene ficha: eso no es «0 % de
 * cobertura», es que el agente de esta instancia no la escribe y la medida no
 * aplica. Enseñar 0 % ahí sería acusarlo de no hacer algo que nunca se le
 * pidió.
 */
async function qualificationCoverage(organizationId: string, start: Date, end: Date) {
  const db = getDb();
  const withQualification = sql`${schema.contact.ficha} is not null and ${schema.contact.ficha}::text <> '{}'`;
  const [cohortContacts, anyOne] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)::int`,
        withQualification: sql<number>`count(*) filter (where ${withQualification})::int`,
      })
      .from(schema.contact)
      .where(
        scoped(
          schema.contact.organizationId,
          organizationId,
          gte(schema.contact.createdAt, start),
          lt(schema.contact.createdAt, end),
          notLabContact(schema.contact.id)
        )
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.contact)
      .where(
        scoped(
          schema.contact.organizationId,
          organizationId,
          withQualification,
          notLabContact(schema.contact.id)
        )
      ),
  ]);

  if ((anyOne[0]?.n ?? 0) === 0) return null;
  return rate(cohortContacts[0]?.withQualification ?? 0, cohortContacts[0]?.total ?? 0);
}
