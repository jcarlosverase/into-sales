import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import type { ResultHeartbeat } from "@/server/central/client";

/**
 * 028 — La llave de licencia de into de la organización (cifrada en reposo,
 * como el token de WhatsApp) y lo último que dijo el central.
 */

type Row = typeof schema.centralLicense.$inferSelect;

/** Lo que puede salir hacia el cliente. NUNCA incluye la llave. */
export type PublicLicense = {
  keyLast4: string;
  lastAttempt: Date | null;
  lastResult: Row["lastResult"];
  lastOk: Date | null;
  plan: { code: string; name: string } | null;
  account: "active" | "suspended" | null;
};

export function toPublic(row: Row): PublicLicense {
  return {
    keyLast4: row.keyLast4,
    lastAttempt: row.lastAttemptAt,
    lastResult: row.lastResult,
    lastOk: row.lastOkAt,
    plan: row.planCode && row.planName ? { code: row.planCode, name: row.planName } : null,
    account: row.customerStatus,
  };
}

async function rowDe(organizationId: string): Promise<Row | null> {
  const rows = await getDb()
    .select()
    .from(schema.centralLicense)
    .where(scoped(schema.centralLicense.organizationId, organizationId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getPublicLicense(organizationId: string): Promise<PublicLicense | null> {
  const row = await rowDe(organizationId);
  return row ? toPublic(row) : null;
}

export async function getKey(organizationId: string): Promise<{ key: string; interval: number | null } | null> {
  const row = await rowDe(organizationId);
  if (!row) return null;
  return {
    key: decryptSecret({ cipher: row.keyCipher, iv: row.keyIv, tag: row.keyTag }),
    interval: row.nextHeartbeatSeconds,
  };
}

/** Las organizaciones que tienen llave (en la raíz, a lo más una). */
export async function organizationsWithKey(): Promise<string[]> {
  const rows = await getDb()
    .select({ organizationId: schema.centralLicense.organizationId })
    .from(schema.centralLicense);
  return rows.map((r) => r.organizationId);
}

/**
 * Guarda una llave nueva y reemplaza la anterior entera: lo del último latido
 * era de otra llave y no vale para esta (data-model).
 */
export async function saveKey(organizationId: string, key: string): Promise<void> {
  const enc = encryptSecret(key);
  const now = new Date();
  const values = {
    keyCipher: enc.cipher,
    keyIv: enc.iv,
    keyTag: enc.tag,
    keyLast4: key.slice(-4),
    lastAttemptAt: null,
    lastResult: null,
    lastOkAt: null,
    planCode: null,
    planName: null,
    customerStatus: null,
    nextHeartbeatSeconds: null,
    updatedAt: now,
  };
  await getDb()
    .insert(schema.centralLicense)
    .values({ id: newId("centralLicense"), organizationId, ...values })
    .onConflictDoUpdate({ target: schema.centralLicense.organizationId, set: values });
}

export async function removeKey(organizationId: string): Promise<void> {
  await getDb()
    .delete(schema.centralLicense)
    .where(scoped(schema.centralLicense.organizationId, organizationId));
}

/** D6: anota el intento; si el central aceptó, también el plan y la cuenta. */
export async function noteResult(organizationId: string, result: ResultHeartbeat, now: Date): Promise<void> {
  const set = result.ok
    ? {
        lastAttemptAt: now,
        lastResult: "ok" as const,
        lastOkAt: now,
        planCode: result.response.plan.code,
        planName: result.response.plan.name,
        customerStatus: result.response.customer.status,
        nextHeartbeatSeconds: result.response.next_heartbeat_seconds ?? null,
        updatedAt: now,
      }
    : { lastAttemptAt: now, lastResult: result.result, updatedAt: now };
  await getDb()
    .update(schema.centralLicense)
    .set(set)
    .where(scoped(schema.centralLicense.organizationId, organizationId));
}
