import { logger } from "@/lib/observability/logger";
import { CentralWalletError } from "@/server/central/wallet";
import { googleSaveUrl } from "@/server/stamp-card/google-pass";
import { findPublicCardFor } from "@/server/stamp-card/public";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

/**
 * 1023, AC8 — «Guardar en Google Wallet»: pide al central el enlace firmado
 * con el estado de ahora y lleva al cliente a Google.
 */
export async function GET(req: Request, { params }: Params) {
  const { token } = await params;
  const found = await findPublicCardFor(token, req.headers);
  if (found.kind === "not_found") return new Response(null, { status: 404 });
  if (found.kind === "rate_limited") return new Response("Demasiadas consultas. Espera un minuto.", { status: 429 });
  try {
    const url = await googleSaveUrl(found.card, found.program);
    return new Response(null, { status: 303, headers: { location: url, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  } catch (err) {
    const code = err instanceof CentralWalletError ? err.code : "error";
    logger.warn({ event: "stamp_card.google_link_failed", code }, "google link failed");
    return new Response("Google Wallet no está disponible en este momento. Tu tarjeta sigue funcionando en esta página.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}
