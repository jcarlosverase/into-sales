import { timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { logger } from "@/lib/observability/logger";
import { CentralWalletError, getWalletConfig } from "@/server/central/wallet";
import { buildApplePass, appleSerialNumber, cardSerialOf } from "./apple-pass";
import type { StampCard } from "./cards";
import { stampCardDisabledResponse, stampCardEnabled } from "./flag";
import { hashToken } from "./tokens";

/**
 * 1023, AC9 — El servicio web de Apple Wallet («PassKit Web Service»). El
 * iPhone registra el pase, recibe el aviso vacío que manda el central y
 * pide aquí la versión nueva. Las rutas de `src/app/api/wallet/apple/v1/`
 * solo llaman a estas funciones.
 *
 * https://developer.apple.com/documentation/walletpasses/adding-a-web-service-to-update-passes
 */

const DEVICE_PATTERN = /^[A-Za-z0-9]{1,128}$/;
const PASS_TYPE_PATTERN = /^pass\.[A-Za-z0-9.-]{1,120}$/;
const PUSH_TOKEN_PATTERN = /^[0-9A-Fa-f]{16,200}$/;

const empty = (status: number) => new Response(null, { status });

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * La tarjeta de un `serialNumber`, si el `Authorization: ApplePass <token>`
 * es el suyo. Cualquier otra cosa es 401, sin decir si el serial existe.
 */
async function authorizedCard(req: Request, serialNumber: string): Promise<StampCard | null> {
  const serial = cardSerialOf(serialNumber);
  const token = /^ApplePass ([A-Za-z0-9_-]{16,64})$/.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!serial || !token) return null;
  const [card] = await getDb().select().from(schema.stampCard).where(eq(schema.stampCard.serial, serial)).limit(1);
  if (!card || !sameHash(card.appleAuthTokenHash, hashToken(token))) return null;
  return card;
}

/** Marca de «actualizado» de Apple: milisegundos, en texto. */
function updatedTag(date: Date): string {
  return String(date.getTime());
}

export async function registerDevice(req: Request, device: string, passType: string, serialNumber: string): Promise<Response> {
  if (!stampCardEnabled()) return stampCardDisabledResponse();
  if (!DEVICE_PATTERN.test(device) || !PASS_TYPE_PATTERN.test(passType)) return empty(404);
  const card = await authorizedCard(req, serialNumber);
  if (!card) return empty(401);
  const body = (await req.json().catch(() => null)) as { pushToken?: unknown } | null;
  const pushToken = typeof body?.pushToken === "string" ? body.pushToken : "";
  if (!PUSH_TOKEN_PATTERN.test(pushToken)) return empty(400);

  const db = getDb();
  const [inserted] = await db
    .insert(schema.applePassRegistration)
    .values({ id: newId("applePassRegistration"), organizationId: card.organizationId, cardId: card.id, deviceLibraryId: device, pushToken })
    .onConflictDoNothing({ target: [schema.applePassRegistration.deviceLibraryId, schema.applePassRegistration.cardId] })
    .returning({ id: schema.applePassRegistration.id });
  if (inserted) return empty(201);
  // Ya estaba: el token de push puede haber cambiado.
  await db
    .update(schema.applePassRegistration)
    .set({ pushToken })
    .where(and(eq(schema.applePassRegistration.deviceLibraryId, device), eq(schema.applePassRegistration.cardId, card.id)));
  return empty(200);
}

export async function unregisterDevice(req: Request, device: string, passType: string, serialNumber: string): Promise<Response> {
  if (!stampCardEnabled()) return stampCardDisabledResponse();
  if (!DEVICE_PATTERN.test(device) || !PASS_TYPE_PATTERN.test(passType)) return empty(404);
  const card = await authorizedCard(req, serialNumber);
  if (!card) return empty(401);
  await getDb()
    .delete(schema.applePassRegistration)
    .where(and(eq(schema.applePassRegistration.deviceLibraryId, device), eq(schema.applePassRegistration.cardId, card.id)));
  return empty(200);
}

/**
 * Los pases del dispositivo que cambiaron desde la marca que trae. Apple no
 * manda autenticación aquí: solo se responden seriales de ese dispositivo.
 */
export async function updatedSerials(device: string, passType: string, since: string | null): Promise<Response> {
  if (!stampCardEnabled()) return stampCardDisabledResponse();
  if (!DEVICE_PATTERN.test(device) || !PASS_TYPE_PATTERN.test(passType)) return empty(404);
  const sinceMs = since && /^\d{1,16}$/.test(since) ? Number(since) : null;
  const rows = await getDb()
    .select({ organizationId: schema.stampCard.organizationId, serial: schema.stampCard.serial, updatedAt: schema.stampCard.updatedAt })
    .from(schema.applePassRegistration)
    .innerJoin(schema.stampCard, eq(schema.stampCard.id, schema.applePassRegistration.cardId))
    .where(
      and(
        eq(schema.applePassRegistration.deviceLibraryId, device),
        // Al milisegundo, como la marca: un microsegundo de más no repite la descarga.
        sinceMs === null
          ? undefined
          : sql`date_trunc('milliseconds', ${schema.stampCard.updatedAt}) > ${new Date(sinceMs).toISOString()}::timestamptz`
      )
    );
  if (rows.length === 0) return empty(204);

  const serialNumbers: string[] = [];
  let latest = 0;
  for (const row of rows) {
    try {
      const config = await getWalletConfig(row.organizationId);
      serialNumbers.push(appleSerialNumber(config.scope, row.serial));
      latest = Math.max(latest, row.updatedAt.getTime());
    } catch {
      // Sin el prefijo del central no se puede nombrar el pase: el iPhone vuelve a preguntar.
      return empty(503);
    }
  }
  return Response.json({ serialNumbers, lastUpdated: updatedTag(new Date(latest)) });
}

/** El pase al día, con `Last-Modified`; si no cambió desde `If-Modified-Since`, 304. */
export async function latestPass(req: Request, passType: string, serialNumber: string): Promise<Response> {
  if (!stampCardEnabled()) return stampCardDisabledResponse();
  if (!PASS_TYPE_PATTERN.test(passType)) return empty(404);
  const card = await authorizedCard(req, serialNumber);
  if (!card) return empty(401);
  // HTTP solo tiene segundos: se compara al segundo.
  const modified = new Date(Math.floor(card.updatedAt.getTime() / 1000) * 1000);
  const ims = req.headers.get("if-modified-since");
  if (ims && !Number.isNaN(Date.parse(ims)) && modified.getTime() <= Date.parse(ims)) return empty(304);

  const [program] = await getDb().select().from(schema.stampProgram).where(eq(schema.stampProgram.id, card.programId)).limit(1);
  if (!program) return empty(404);
  try {
    const pass = await buildApplePass(card, program);
    return new Response(new Uint8Array(pass), {
      status: 200,
      headers: {
        "content-type": "application/vnd.apple.pkpass",
        "last-modified": modified.toUTCString(),
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    logger.warn({ event: "stamp_card.apple_pass_failed", code: err instanceof CentralWalletError ? err.code : "error" }, "apple pass failed");
    return empty(503);
  }
}

/** Los errores que reporta el iPhone. Solo se cuentan: pueden traer URLs con el serial. */
export async function receiveLog(req: Request): Promise<Response> {
  if (!stampCardEnabled()) return stampCardDisabledResponse();
  const body = (await req.json().catch(() => null)) as { logs?: unknown } | null;
  const count = Array.isArray(body?.logs) ? body.logs.length : 0;
  logger.info({ event: "stamp_card.apple_log", count }, "apple wallet log");
  return empty(200);
}
