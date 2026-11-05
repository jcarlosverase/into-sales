import { getEnv } from "@/lib/env";
import { readableInk } from "@/lib/branding";
import { getBranding } from "@/server/branding";
import { getWalletConfig, signAppleManifest, CentralWalletError } from "@/server/central/wallet";
import { publicCardUrl, staffCardUrl, type StampCard } from "./cards";
import { applePassImages, brandLogoDataUri } from "./images";
import { assemblePkpass, buildManifest, buildPassJson } from "./pkpass";
import type { StampProgram } from "./program";
import { appleAuthTokenFor } from "./tokens";

/**
 * 1023, D8 — El pase de Apple Wallet de una tarjeta. El CRM lo arma entero
 * y el central solo firma su manifiesto con el certificado de into. El
 * dispositivo vuelve a pedirlo al CRM (servicio web, AC9) cuando cambia.
 */

/** `<scope>-<serial>`: el `serialNumber` que firma el central (contrato, prefijo del cliente). */
export function appleSerialNumber(scope: string, serial: string): string {
  return `${scope}-${serial}`;
}

/** El serial de la tarjeta dentro de un `serialNumber` de Apple, o null si no tiene la forma. */
export function cardSerialOf(serialNumber: string): string | null {
  const m = /^c[a-z2-7]{8}-([A-Za-z0-9]{22})$/.exec(serialNumber);
  return m ? m[1]! : null;
}

/** La base del servicio web de Apple, solo si el CRM tiene HTTPS público. */
export function appleWebServiceUrl(): string | null {
  const base = getEnv().APP_BASE_URL.replace(/\/+$/, "");
  return base.startsWith("https://") ? `${base}/api/wallet/apple` : null;
}

export async function buildApplePass(card: StampCard, program: StampProgram): Promise<Buffer> {
  const organizationId = card.organizationId;
  const config = await getWalletConfig(organizationId);
  if (!config.apple.enabled) throw new CentralWalletError("wallet_unavailable");
  const branding = await getBranding(organizationId);
  const ink = readableInk(program.color);
  const serialNumber = appleSerialNumber(config.scope, card.serial);
  const webService = appleWebServiceUrl();

  const images = await applePassImages({
    name: program.name,
    color: program.color,
    ink,
    logo: await brandLogoDataUri(organizationId, branding),
    stamps: card.stamps,
    stampsRequired: card.stampsRequired,
  });
  const pass = buildPassJson({
    passTypeId: config.apple.passTypeId,
    teamId: config.apple.teamId,
    serialNumber,
    organizationName: branding.name,
    programName: program.name,
    reward: program.reward,
    terms: program.terms,
    color: program.color,
    ink,
    stamps: card.stamps,
    stampsRequired: card.stampsRequired,
    rewardsRedeemed: card.rewardsRedeemed,
    paused: program.status !== "active",
    staffUrl: staffCardUrl(card.serial),
    publicUrl: publicCardUrl(card.id),
    webService: webService ? { url: webService, authenticationToken: appleAuthTokenFor(card.id) } : null,
  });
  const files = { ...images, "pass.json": Buffer.from(JSON.stringify(pass)) };
  const manifest = buildManifest(files);
  const signature = await signAppleManifest(organizationId, serialNumber, manifest);
  return assemblePkpass(files, manifest, signature);
}
