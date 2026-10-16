import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

/**
 * 023 — Leftovers of the hardware-store demo ("Ferretería El Martillo") that
 * Vocero CRM loaded with `pnpm seed:demo` or the inbox's demo button before
 * IntoSales replaced it. Recognised by their exact values, so a business's
 * own data is never matched, and removed when an industry sample is loaded.
 */

type Db = ReturnType<typeof getDb>;

/** The demo contacts' synthetic phones (5215612340001…08). */
const LEGACY_PHONES = Array.from(
  { length: 8 },
  (_, i) => `52156123400${String(i + 1).padStart(2, "0")}`
);

/** The demo's knowledge entries: question → exact answer. */
const LEGACY_QA: Record<string, string> = {
  "¿Cuál es el horario?": "Lunes a sábado de 8:00 a 19:00 y domingos de 9:00 a 14:00.",
  "¿Dónde están ubicados?":
    "Av. Hidalgo 245, colonia Centro. Hay estacionamiento gratuito para clientes en la calle lateral.",
  "¿Hacen envíos a domicilio?":
    "Sí: entrega el mismo día en la zona si confirmas antes de la 1 pm. Flete local $150 MXN; gratis en compras mayores a $3,000 MXN.",
  "¿Qué métodos de pago aceptan?":
    "Efectivo, tarjeta (crédito/débito), transferencia SPEI y pago contra entrega en pedidos locales.",
  "¿Dan factura?":
    "Sí, facturamos el mismo día. Envíanos tu constancia de situación fiscal y el ticket de compra.",
  "¿Tienen precios de mayoreo?":
    "Sí: en cemento, mortero y varilla hay precio especial a partir de 10 unidades; en pintura a partir de 5 cubetas. Pide tu cotización por WhatsApp.",
  "¿Qué marcas de herramienta manejan?":
    "Truper, Pretul, DeWalt, Makita y Ryobi en eléctrica; Volteck y Condulac en material eléctrico; Comex y Berel en pintura.",
};

const LEGACY_BLOCK_PREFIX = "Ferretería El Martillo — ";

/** Is this the demo's agent profile (so loading a sample may replace it)? */
export function isLegacyDemoAgent(profile: {
  name: string;
  greeting: string | null;
}): boolean {
  return (
    profile.name === "Martillito" &&
    (profile.greeting ?? "").startsWith("¡Hola! Soy Martillito")
  );
}

export type LegacyCleanup = { contacts: number; knowledge: number; labRuns: number };

export async function removeLegacyDemo(
  db: Db,
  organizationId: string
): Promise<LegacyCleanup> {
  // Demo contacts: their synthetic phone AND demo message ids, so a real
  // customer who happened to share a number is never touched.
  const demoContacts = await db
    .select({ id: schema.contact.id })
    .from(schema.contact)
    .where(
      scoped(
        schema.contact.organizationId,
        organizationId,
        inArray(schema.contact.phone, LEGACY_PHONES),
        sql`exists (
          select 1 from ${schema.conversation} c
          join ${schema.message} m on m.conversation_id = c.id
          where c.contact_id = ${schema.contact.id}
            and m.wa_message_id like 'wamid.demo.%'
        )`
      )
    );
  const contactIds = demoContacts.map((c) => c.id);
  if (contactIds.length > 0) {
    await db
      .delete(schema.contact)
      .where(
        scoped(schema.contact.organizationId, organizationId, inArray(schema.contact.id, contactIds))
      );
  }

  const knowledge = await db
    .delete(schema.kbEntry)
    .where(
      scoped(
        schema.kbEntry.organizationId,
        organizationId,
        or(
          and(eq(schema.kbEntry.kind, "block"), like(schema.kbEntry.content, `${LEGACY_BLOCK_PREFIX}%`)),
          ...Object.entries(LEGACY_QA).map(([question, answer]) =>
            and(eq(schema.kbEntry.question, question), eq(schema.kbEntry.answer, answer))
          )
        )
      )
    )
    .returning({ id: schema.kbEntry.id });

  // The demo's saved Lab run: its cases quote the demo's own catalogue.
  const runs = await db
    .select({ id: schema.agentTestCase.runId })
    .from(schema.agentTestCase)
    .where(
      scoped(
        schema.agentTestCase.organizationId,
        organizationId,
        sql`${schema.agentTestCase.transcript}::text like '%Truper 20V en $1,899 MXN%'`
      )
    );
  const runIds = [...new Set(runs.map((r) => r.id))];
  if (runIds.length > 0) {
    await db
      .delete(schema.agentTestCase)
      .where(
        scoped(schema.agentTestCase.organizationId, organizationId, inArray(schema.agentTestCase.runId, runIds))
      );
    await db
      .delete(schema.agentTestRun)
      .where(
        scoped(schema.agentTestRun.organizationId, organizationId, inArray(schema.agentTestRun.id, runIds))
      );
  }

  return { contacts: contactIds.length, knowledge: knowledge.length, labRuns: runIds.length };
}
