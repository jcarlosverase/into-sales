import { and, asc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import type { ResourceKind } from "@/lib/agenda-resources";
import {
  getSettings,
  normalizeWeeklyHours,
  type WeeklyHours,
} from "@/server/agenda/settings";

/**
 * 1029 — Los profesionales o recursos de la agenda.
 *
 * Sin ninguno activo la agenda es la del negocio, como siempre. No hay borrado:
 * archivar conserva el nombre en las citas pasadas.
 */

export type AgendaResource = {
  id: string;
  kind: ResourceKind;
  name: string;
  weeklyHours: WeeklyHours;
  position: number;
  active: boolean;
};

export type ResourceErrorCode =
  | "resource_not_found"
  | "resource_has_bookings"
  | "resource_name_taken"
  | "invalid";

export class ResourceError extends Error {
  code: ResourceErrorCode;
  /** En `resource_has_bookings`: cuántas citas futuras hay que mover. */
  count: number;

  constructor(code: ResourceErrorCode, message: string, count = 0) {
    super(message);
    this.name = "ResourceError";
    this.code = code;
    this.count = count;
  }
}

/** Lo único que se necesita para leer: vale la base o una transacción abierta. */
export type Reader = Pick<ReturnType<typeof getDb>, "select">;

function toResource(row: typeof schema.agendaResource.$inferSelect): AgendaResource {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    weeklyHours: normalizeWeeklyHours(row.weeklyHours),
    position: row.position,
    active: row.active,
  };
}

/** Los activos, en el orden de la lista. */
export async function listActiveResources(
  organizationId: string,
  reader: Reader = getDb()
): Promise<AgendaResource[]> {
  const rows = await reader
    .select()
    .from(schema.agendaResource)
    .where(
      scoped(
        schema.agendaResource.organizationId,
        organizationId,
        eq(schema.agendaResource.active, true)
      )
    )
    .orderBy(asc(schema.agendaResource.position), asc(schema.agendaResource.createdAt));
  return rows.map(toResource);
}

export async function listResources(
  organizationId: string,
  opts?: { includeArchived?: boolean }
): Promise<AgendaResource[]> {
  if (!opts?.includeArchived) return listActiveResources(organizationId);
  const rows = await getDb()
    .select()
    .from(schema.agendaResource)
    .where(scoped(schema.agendaResource.organizationId, organizationId))
    .orderBy(asc(schema.agendaResource.position), asc(schema.agendaResource.createdAt));
  return rows.map(toResource);
}

export async function getResource(
  organizationId: string,
  resourceId: string,
  reader: Reader = getDb()
): Promise<AgendaResource | null> {
  const rows = await reader
    .select()
    .from(schema.agendaResource)
    .where(
      scoped(
        schema.agendaResource.organizationId,
        organizationId,
        eq(schema.agendaResource.id, resourceId)
      )
    )
    .limit(1);
  return rows[0] ? toResource(rows[0]) : null;
}

function cleanName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new ResourceError("invalid", "Escribe un nombre");
  return trimmed;
}

/** 23505 = unique_violation; Drizzle envuelve el error del driver en `cause`. */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

const NAME_TAKEN = "Ya hay alguien activo con ese nombre";

/**
 * Sin `weeklyHours`, copia el horario del negocio. Si es el primero, adopta las
 * citas futuras sin profesional: si no, ocuparían a todos los que se agreguen.
 */
export async function createResource(
  organizationId: string,
  input: { kind: ResourceKind; name: string; weeklyHours?: unknown },
  now = new Date()
): Promise<{ resource: AgendaResource; adoptedBookings: number }> {
  const name = cleanName(input.name);
  const settings = await getSettings(organizationId);
  const weeklyHours =
    input.weeklyHours === undefined
      ? settings.weeklyHours
      : normalizeWeeklyHours(input.weeklyHours);

  try {
    return await getDb().transaction(async (tx) => {
      const active = await listActiveResources(organizationId, tx);
      const position = (active[active.length - 1]?.position ?? -1) + 1;
      const inserted = await tx
        .insert(schema.agendaResource)
        .values({
          id: newId("agendaResource"),
          organizationId,
          kind: input.kind,
          name,
          weeklyHours,
          position,
        })
        .returning();
      const row = inserted[0]!;

      let adoptedBookings = 0;
      if (active.length === 0) {
        const adopted = await tx
          .update(schema.booking)
          .set({ resourceId: row.id, updatedAt: now })
          .where(
            scoped(
              schema.booking.organizationId,
              organizationId,
              and(
                eq(schema.booking.kind, "session"),
                eq(schema.booking.status, "agendada"),
                isNull(schema.booking.resourceId),
                gte(schema.booking.scheduledAt, now)
              )
            )
          )
          .returning({ id: schema.booking.id });
        adoptedBookings = adopted.length;
      }
      return { resource: toResource(row), adoptedBookings };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ResourceError("resource_name_taken", NAME_TAKEN);
    throw err;
  }
}

/** Citas futuras que impiden archivar a alguien. */
async function futureBookings(
  organizationId: string,
  resourceId: string,
  now: Date
): Promise<number> {
  const rows = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.booking)
    .where(
      scoped(
        schema.booking.organizationId,
        organizationId,
        and(
          eq(schema.booking.resourceId, resourceId),
          eq(schema.booking.kind, "session"),
          eq(schema.booking.status, "agendada"),
          eq(schema.booking.isTest, false),
          gte(schema.booking.scheduledAt, now)
        )
      )
    );
  return rows[0]?.count ?? 0;
}

export async function updateResource(
  organizationId: string,
  resourceId: string,
  input: {
    kind?: ResourceKind;
    name?: string;
    weeklyHours?: unknown;
    position?: number;
    active?: boolean;
  },
  now = new Date()
): Promise<AgendaResource> {
  const current = await getResource(organizationId, resourceId);
  if (!current) throw new ResourceError("resource_not_found", "No encontramos a esa persona");

  if (input.active === false && current.active) {
    const count = await futureBookings(organizationId, resourceId, now);
    if (count > 0) {
      throw new ResourceError(
        "resource_has_bookings",
        count === 1
          ? "Tiene 1 cita futura: muévela antes de archivar"
          : `Tiene ${count} citas futuras: muévelas antes de archivar`,
        count
      );
    }
  }

  try {
    const rows = await getDb()
      .update(schema.agendaResource)
      .set({
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.name !== undefined ? { name: cleanName(input.name) } : {}),
        ...(input.weeklyHours !== undefined
          ? { weeklyHours: normalizeWeeklyHours(input.weeklyHours) }
          : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        updatedAt: now,
      })
      .where(
        scoped(
          schema.agendaResource.organizationId,
          organizationId,
          eq(schema.agendaResource.id, resourceId)
        )
      )
      .returning();
    return toResource(rows[0]!);
  } catch (err) {
    if (isUniqueViolation(err)) throw new ResourceError("resource_name_taken", NAME_TAKEN);
    throw err;
  }
}

/** Los nombres de unas citas, sin una consulta por cita. */
export async function resourceNames(
  organizationId: string,
  ids: string[]
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await getDb()
    .select({ id: schema.agendaResource.id, name: schema.agendaResource.name })
    .from(schema.agendaResource)
    .where(
      scoped(
        schema.agendaResource.organizationId,
        organizationId,
        inArray(schema.agendaResource.id, ids)
      )
    );
  return new Map(rows.map((r) => [r.id, r.name]));
}
