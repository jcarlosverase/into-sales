import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { getBranding } from "@/server/branding";
import type { Branding } from "@/lib/branding";
import { findPublicCard, staffCardUrl } from "./cards";
import { stampCardEnabled } from "./flag";
import { PUBLIC_TOKEN_PATTERN } from "./tokens";

/** D5 — 30 vistas por minuto por IP: de sobra para un cliente, poco para adivinar tokens. */
export const PUBLIC_CARD_RATE_LIMIT = { windowMs: 60_000, max: 30 } as const;

export type PublicCard = {
  name: string;
  reward: string;
  terms: string | null;
  color: string;
  paused: boolean;
  stamps: number;
  stampsRequired: number;
  rewardsRedeemed: number;
  /** Lo que codifica el QR: la pantalla del equipo para sellar (D6). */
  staffUrl: string;
  branding: Pick<Branding, "name" | "accent" | "favicon">;
};

export type PublicCardResult =
  | { kind: "ok"; card: PublicCard }
  | { kind: "not_found" }
  | { kind: "rate_limited" };

/**
 * Lo que la página pública puede mostrar de una tarjeta: el programa y los
 * sellos, nunca el contacto. Con la bandera apagada o un token con otra forma
 * es 404 sin tocar la base.
 */
export async function loadPublicCard(token: string, headers: Headers | null): Promise<PublicCardResult> {
  if (!stampCardEnabled() || !PUBLIC_TOKEN_PATTERN.test(token)) return { kind: "not_found" };
  if (!checkRateLimit(`stamp-card-public:${clientIp(headers)}`, PUBLIC_CARD_RATE_LIMIT).allowed) {
    return { kind: "rate_limited" };
  }
  const found = await findPublicCard(token);
  if (!found || found.program.status === "archived") return { kind: "not_found" };
  const { card, program } = found;
  const branding = await getBranding(card.organizationId);
  return {
    kind: "ok",
    card: {
      name: program.name,
      reward: program.reward,
      terms: program.terms,
      color: program.color,
      paused: program.status === "paused",
      stamps: card.stamps,
      stampsRequired: card.stampsRequired,
      rewardsRedeemed: card.rewardsRedeemed,
      staffUrl: staffCardUrl(card.serial),
      branding: { name: branding.name, accent: branding.accent, favicon: branding.favicon },
    },
  };
}
