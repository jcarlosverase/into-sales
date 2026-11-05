import { logger } from "@/lib/observability/logger";
import { CentralWalletError } from "@/server/central/wallet";
import { buildApplePass } from "@/server/stamp-card/apple-pass";
import { findPublicCardFor } from "@/server/stamp-card/public";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

/**
 * 1023, AC8 — «Agregar a Apple Wallet»: el `.pkpass` de la tarjeta, armado
 * aquí y firmado por el central. Mismo token y mismo límite que la página.
 */
export async function GET(req: Request, { params }: Params) {
  const { token } = await params;
  const found = await findPublicCardFor(token, req.headers);
  if (found.kind === "not_found") return new Response(null, { status: 404 });
  if (found.kind === "rate_limited") return new Response("Demasiadas consultas. Espera un minuto.", { status: 429 });
  try {
    const pass = await buildApplePass(found.card, found.program);
    return new Response(new Uint8Array(pass), {
      headers: {
        "content-type": "application/vnd.apple.pkpass",
        "content-disposition": 'attachment; filename="tarjeta.pkpass"',
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    });
  } catch (err) {
    const code = err instanceof CentralWalletError ? err.code : "error";
    logger.warn({ event: "stamp_card.apple_pass_failed", code }, "apple pass failed");
    return new Response("Apple Wallet no está disponible en este momento. Tu tarjeta sigue funcionando en esta página.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}
