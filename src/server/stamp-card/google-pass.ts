import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { stampsLeft } from "@/lib/stamp-card";
import {
  CentralWalletError,
  getWalletConfig,
  googleSaveLink,
  patchGoogleObject,
  putGoogleClass,
  type GoogleClassBody,
  type GoogleObjectBody,
} from "@/server/central/wallet";
import { staffCardUrl, type StampCard } from "./cards";
import type { StampProgram } from "./program";

/**
 * 1023, D8 y D11 — La tarjeta en Google Wallet: una `LoyaltyClass` por
 * programa y un `LoyaltyObject` por tarjeta. El central las firma y las
 * aplica con la cuenta de emisor de into. El objeto lleva sellos, premio y el
 * serial: **nunca** nombre ni teléfono del cliente (AC11).
 */

function appBase(): string {
  return getEnv().APP_BASE_URL.replace(/\/+$/, "");
}

/** Google solo acepta imágenes por HTTPS público: en desarrollo no hay Google Wallet. */
export function googleImagesAvailable(): boolean {
  return appBase().startsWith("https://");
}

function hexNoHash(hex: string): string {
  return hex.replace(/^#/, "").toLowerCase();
}

export function logoImageUrl(color: string, version: number): string {
  return `${appBase()}/api/wallet/images/logo?c=${hexNoHash(color)}&v=${version}`;
}

/** El sufijo de la clase: el id del programa (ya cumple `[A-Za-z0-9_-]`). */
export function classSuffixOf(program: Pick<StampProgram, "id">): string {
  return program.id;
}

export function buildGoogleClass(program: StampProgram): GoogleClassBody {
  const modules = [{ id: "reward", header: "Premio", body: program.reward }];
  if (program.terms) modules.push({ id: "terms", header: "Condiciones", body: program.terms });
  return {
    programName: program.name,
    programLogo: { sourceUri: { uri: logoImageUrl(program.color, program.version) } },
    hexBackgroundColor: program.color,
    textModulesData: modules,
  };
}

/**
 * El objeto lleva solo lo que el central deja actualizar después (los
 * sellos): una imagen o un texto con los sellos quedarían viejos al primer
 * cambio. El premio y las condiciones van en la clase.
 */
export function buildGoogleObject(card: StampCard): GoogleObjectBody {
  return {
    loyaltyPoints: { label: "Sellos", balance: { int: Math.min(card.stamps, card.stampsRequired) } },
    barcode: { type: "QR_CODE", value: staffCardUrl(card.serial), alternateText: "Muestra este código en caja" },
  };
}

/** La clase al día con el programa. El central no aplica una versión que ya tiene. */
const applied = globalThis as unknown as { __googleClassApplied?: Map<string, number> };
export async function ensureGoogleClass(program: StampProgram): Promise<void> {
  applied.__googleClassApplied ??= new Map();
  if ((applied.__googleClassApplied.get(program.id) ?? 0) >= program.version) return;
  await putGoogleClass(program.organizationId, classSuffixOf(program), program.version, buildGoogleClass(program));
  applied.__googleClassApplied.set(program.id, program.version);
}

/**
 * El enlace «Guardar en Google Wallet» de una tarjeta, con su estado de
 * ahora. Desde que se da, cada cambio se le pasa al central (`wallet-sync`).
 */
export async function googleSaveUrl(card: StampCard, program: StampProgram): Promise<string> {
  const config = await getWalletConfig(card.organizationId);
  if (!config.google.enabled || !googleImagesAvailable()) throw new CentralWalletError("wallet_unavailable");
  await ensureGoogleClass(program);
  const url = await googleSaveLink(card.organizationId, {
    classSuffix: classSuffixOf(program),
    objectSuffix: card.serial,
    object: buildGoogleObject(card),
  });
  await getDb().update(schema.stampCard).set({ googleLinkIssuedAt: new Date() }).where(eq(schema.stampCard.id, card.id));
  return url;
}

/**
 * D10 — Pasa los sellos al objeto guardado. El mensaje es el aviso que ve el
 * cliente en su Android (Google limita cuántos por día). Anota si la tiene
 * guardada, para la ficha («en su wallet»).
 */
export async function syncGoogleObject(card: StampCard): Promise<void> {
  const db = getDb();
  const [program] = await db.select().from(schema.stampProgram).where(eq(schema.stampProgram.id, card.programId)).limit(1);
  if (!program) return;
  await ensureGoogleClass(program);
  const left = stampsLeft(card);
  const shown = Math.min(card.stamps, card.stampsRequired);
  const result = await patchGoogleObject(card.organizationId, card.serial, {
    version: card.passVersion,
    loyaltyPoints: shown,
    pointsLabel: "Sellos",
    message:
      left === 0
        ? { header: "¡Tarjeta completa!", body: `Pide tu premio: ${program.reward}` }
        : { header: program.name, body: `Tienes ${shown} de ${card.stampsRequired} sellos. Te faltan ${left}.` },
  });
  if (result.saved !== card.googleObjectSaved) {
    await db.update(schema.stampCard).set({ googleObjectSaved: result.saved }).where(eq(schema.stampCard.id, card.id));
  }
}
