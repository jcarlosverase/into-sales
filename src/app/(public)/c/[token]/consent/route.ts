import { publicCardUrl, recordConsent } from "@/server/stamp-card/cards";
import { findPublicCardFor } from "@/server/stamp-card/public";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

/**
 * 1023, D13 — El cliente acepta guardar la tarjeta en su celular. Sin sesión:
 * el token de la tarjeta es la prueba de que es suya. La casilla se comprueba
 * también aquí, no solo en el navegador.
 */
export async function POST(req: Request, { params }: Params) {
  const { token } = await params;
  const found = await findPublicCardFor(token, req.headers);
  if (found.kind === "not_found") return new Response(null, { status: 404 });
  if (found.kind === "rate_limited") return new Response("Demasiadas consultas. Espera un minuto.", { status: 429 });
  const form = await req.formData().catch(() => null);
  if (form?.get("accept") === "on") await recordConsent(found.card);
  return new Response(null, {
    status: 303,
    headers: { location: publicCardUrl(found.card.id), "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
}
