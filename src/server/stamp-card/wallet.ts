import { stampCardEnabled } from "./flag";
import { CentralWalletError, getWalletConfig } from "@/server/central/wallet";
import { googleImagesAvailable } from "./google-pass";

/**
 * 1023, D9 y AC10 — ¿Qué botones de wallet ofrece la tarjeta? Sin central,
 * sin llave o con un plan sin wallet, no aparecen (la página web es la
 * tarjeta). Con el central caído, se explica en vez de fallar.
 */

export type WalletOfferState = "available" | "hidden" | "unavailable";
export type WalletOffer = { apple: WalletOfferState; google: WalletOfferState };

const HIDDEN: WalletOffer = { apple: "hidden", google: "hidden" };

export async function walletAvailability(organizationId: string): Promise<WalletOffer> {
  if (!stampCardEnabled()) return HIDDEN;
  try {
    const config = await getWalletConfig(organizationId);
    return {
      apple: config.apple.enabled ? "available" : "hidden",
      // Google descarga el logo del CRM: sin HTTPS público no hay Google Wallet.
      google: config.google.enabled && googleImagesAvailable() ? "available" : "hidden",
    };
  } catch (err) {
    if (err instanceof CentralWalletError && err.transient) return { apple: "unavailable", google: "unavailable" };
    return HIDDEN;
  }
}
