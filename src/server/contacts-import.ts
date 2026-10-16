import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { guessMapping, planImport, type ImportMapping, type PlannedRow, type RowStatus } from "@/lib/import/rules";
import { readTable } from "@/lib/import/table";
import { createLeadForContact } from "@/server/inbox/lead-activity";

/**
 * 030 — Importar contactos: vista previa e importación. El archivo llega dos
 * veces y no se guarda entre una y otra (D6); la importación vuelve a validar
 * todo y nunca duplica ni pisa un contacto existente (D4).
 */

export const PREVIEW_SAMPLE = 20;

/** Los teléfonos de la lista que ya son contactos de WhatsApp del negocio. */
async function existingPhones(organizationId: string, phones: string[]): Promise<Set<string>> {
  if (phones.length === 0) return new Set();
  const rows = await getDb()
    .select({ phone: schema.contact.waIdentity })
    .from(schema.contact)
    .where(
      scoped(
        schema.contact.organizationId,
        organizationId,
        eq(schema.contact.channel, "whatsapp"),
        inArray(schema.contact.waIdentity, phones)
      )
    );
  return new Set(rows.map((r) => r.phone));
}

async function plan(organizationId: string, bytes: Uint8Array, fileName: string, mapping: ImportMapping | null, countryCode: string) {
  const { headers, rows } = readTable(bytes, fileName);
  const used = mapping ?? guessMapping(headers);
  // Primero sin existentes, para saber qué teléfonos consultar; luego el plan real.
  const draft = planImport(rows, used, { countryCode }, new Set());
  const phones = [...new Set(draft.rows.flatMap((r) => (r.phone ? [r.phone] : [])))];
  const result = planImport(rows, used, { countryCode }, await existingPhones(organizationId, phones));
  return { headers, mapping: used, ...result };
}

export type ImportPreview = {
  headers: string[];
  mapping: ImportMapping;
  totalRows: number;
  counts: Record<RowStatus, number>;
  /** Las primeras filas, para ver cómo quedan. */
  sample: PlannedRow[];
  /** Hasta 20 filas que no entran, con su motivo. */
  problems: PlannedRow[];
};

export async function previewImport(input: {
  organizationId: string;
  bytes: Uint8Array;
  fileName: string;
  mapping: ImportMapping | null;
  countryCode: string;
}): Promise<ImportPreview> {
  const p = await plan(input.organizationId, input.bytes, input.fileName, input.mapping, input.countryCode);
  return {
    headers: p.headers,
    mapping: p.mapping,
    totalRows: p.rows.length,
    counts: p.counts,
    sample: p.rows.slice(0, PREVIEW_SAMPLE),
    problems: p.rows.filter((r) => r.status !== "ok").slice(0, PREVIEW_SAMPLE),
  };
}

/** D5 — A quién van los leads. */
export type ImportAssign = { kind: "self"; userId: string } | { kind: "rotation" } | { kind: "user"; userId: string } | { kind: "none" };

export type ImportResult = {
  created: number;
  counts: Record<RowStatus, number>;
  /** Lo que no entró, con fila y motivo (hasta 100). */
  skipped: { row: number; name: string; rawPhone: string; status: Exclude<RowStatus, "ok"> }[];
};

export async function runImport(input: {
  organizationId: string;
  actorUserId: string;
  bytes: Uint8Array;
  fileName: string;
  mapping: ImportMapping | null;
  countryCode: string;
  assign: ImportAssign;
}): Promise<ImportResult> {
  const p = await plan(input.organizationId, input.bytes, input.fileName, input.mapping, input.countryCode);
  const db = getDb();
  const stages = await db
    .select({ id: schema.pipelineStage.id, name: schema.pipelineStage.name })
    .from(schema.pipelineStage)
    .where(and(eq(schema.pipelineStage.organizationId, input.organizationId), eq(schema.pipelineStage.kind, "open")));
  const stageByName = new Map(stages.map((s) => [s.name.trim().toLowerCase(), s.id]));
  const assignedUserId = input.assign.kind === "self" || input.assign.kind === "user" ? input.assign.userId : undefined;

  let created = 0;
  const counts = { ...p.counts };
  for (const row of p.rows) {
    if (row.status !== "ok" || !row.phone) continue;
    const [contact] = await db
      .insert(schema.contact)
      .values({
        id: newId("contact"),
        organizationId: input.organizationId,
        name: row.name,
        phone: row.phone,
        waIdentity: row.phone,
        nameSource: "manual",
        notes: row.notes,
        source: "otro",
      })
      .onConflictDoNothing({ target: [schema.contact.organizationId, schema.contact.channel, schema.contact.waIdentity] })
      .returning({ id: schema.contact.id });
    if (!contact) {
      // Alguien lo dio de alta entre la vista y este momento: ya existe.
      counts.ok--;
      counts.exists++;
      row.status = "exists";
      continue;
    }
    await createLeadForContact({
      organizationId: input.organizationId,
      contactId: contact.id,
      stageId: row.stage ? stageByName.get(row.stage.trim().toLowerCase()) : undefined,
      source: "dueno",
      actorUserId: input.actorUserId,
      assignedUserId,
      skipRotation: input.assign.kind === "none",
    });
    created++;
  }
  return {
    created,
    counts,
    skipped: p.rows
      .filter((r): r is PlannedRow & { status: Exclude<RowStatus, "ok"> } => r.status !== "ok")
      .slice(0, 100)
      .map((r) => ({ row: r.row, name: r.name, rawPhone: r.rawPhone, status: r.status })),
  };
}
