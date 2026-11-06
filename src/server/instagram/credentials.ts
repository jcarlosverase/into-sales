import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

/**
 * 014 — Credenciales del canal de Instagram.
 *
 * Mismo contrato que las de WhatsApp (`server/whatsapp/credentials.ts`): el
 * token viaja descifrado solo en memoria y nunca sale en una respuesta de la
 * API — hacia fuera se expone únicamente su cola.
 */

export type InstagramCredentials = {
  id: string;
  organizationId: string;
  source: "zernio" | "meta";
  igUserId: string;
  accountRef: string | null;
  username: string | null;
  webhookSecret: string | null;
  status: "connected" | "reconnect_required";
  token: string;
  /** 1025 — Cuándo vence el token; null si no se sabe (pegado a mano). */
  tokenExpiresAt: Date | null;
};

type Row = typeof schema.instagramCredentials.$inferSelect;

function toCredentials(row: Row): InstagramCredentials {
  return {
    id: row.id,
    organizationId: row.organizationId,
    source: row.source,
    igUserId: row.igUserId,
    accountRef: row.accountRef,
    username: row.username,
    webhookSecret: row.webhookSecret,
    status: row.status,
    tokenExpiresAt: row.tokenExpiresAt,
    token: decryptSecret({
      cipher: row.tokenCipher,
      iv: row.tokenIv,
      tag: row.tokenTag,
    }),
  };
}

export async function getInstagramCredentialsByOrg(
  organizationId: string
): Promise<InstagramCredentials | null> {
  const rows = await getDb()
    .select()
    .from(schema.instagramCredentials)
    .where(eq(schema.instagramCredentials.organizationId, organizationId))
    .limit(1);
  return rows[0] ? toCredentials(rows[0]) : null;
}

/** Enrutado del webhook de Meta: `entry[].id` es el IG_ID del perfil. */
export async function getInstagramCredentialsByIgUserId(
  igUserId: string
): Promise<InstagramCredentials | null> {
  const rows = await getDb()
    .select()
    .from(schema.instagramCredentials)
    .where(eq(schema.instagramCredentials.igUserId, igUserId))
    .limit(1);
  return rows[0] ? toCredentials(rows[0]) : null;
}

/** Enrutado del webhook de Zernio: el evento trae `account.id`, no el perfil. */
export async function getInstagramCredentialsByAccountRef(
  accountRef: string
): Promise<InstagramCredentials | null> {
  const rows = await getDb()
    .select()
    .from(schema.instagramCredentials)
    .where(eq(schema.instagramCredentials.accountRef, accountRef))
    .limit(1);
  return rows[0] ? toCredentials(rows[0]) : null;
}

export async function saveInstagramCredentials(input: {
  organizationId: string;
  source: "zernio" | "meta";
  igUserId: string;
  accountRef: string | null;
  username: string | null;
  token: string;
  webhookSecret: string | null;
  /** 1025 — Conectar con Instagram lo sabe; un token pegado a mano, no. */
  tokenExpiresAt?: Date | null;
}): Promise<void> {
  const db = getDb();
  const enc = encryptSecret(input.token);
  const existing = await getInstagramCredentialsByOrg(input.organizationId);

  const values = {
    organizationId: input.organizationId,
    source: input.source,
    igUserId: input.igUserId,
    accountRef: input.accountRef,
    username: input.username,
    tokenCipher: enc.cipher,
    tokenIv: enc.iv,
    tokenTag: enc.tag,
    webhookSecret: input.webhookSecret,
    tokenExpiresAt: input.tokenExpiresAt ?? null,
    tokenRefreshedAt: null,
    status: "connected" as const,
    updatedAt: new Date(),
  };

  if (existing) {
    await db
      .update(schema.instagramCredentials)
      .set(values)
      .where(eq(schema.instagramCredentials.id, existing.id));
    return;
  }
  await db
    .insert(schema.instagramCredentials)
    .values({ id: newId("credentials"), ...values });
}

/** El token murió: se pausan los envíos y la UI pide reconectar. */
export async function markInstagramReconnectRequired(
  organizationId: string
): Promise<void> {
  await getDb()
    .update(schema.instagramCredentials)
    .set({ status: "reconnect_required", updatedAt: new Date() })
    .where(eq(schema.instagramCredentials.organizationId, organizationId));
}

/** 1025 — Guarda el token renovado. La cuenta y su estado no cambian. */
export async function saveRefreshedInstagramToken(
  id: string,
  token: string,
  expiresAt: Date,
  now: Date
): Promise<void> {
  const enc = encryptSecret(token);
  await getDb()
    .update(schema.instagramCredentials)
    .set({
      tokenCipher: enc.cipher,
      tokenIv: enc.iv,
      tokenTag: enc.tag,
      tokenExpiresAt: expiresAt,
      tokenRefreshedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.instagramCredentials.id, id));
}

/** 1025 — Las cuentas conectadas con la app de Meta: las únicas que se renuevan. */
export async function listConnectedMetaInstagram(): Promise<InstagramCredentials[]> {
  const rows = await getDb()
    .select()
    .from(schema.instagramCredentials)
    .where(
      and(
        eq(schema.instagramCredentials.source, "meta"),
        eq(schema.instagramCredentials.status, "connected")
      )
    );
  return rows.map(toCredentials);
}

export function tokenLast4(token: string): string {
  return token.slice(-4);
}
