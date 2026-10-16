import { mockGuard } from "@/lib/dev-guard";
import { testPng } from "@/server/dev/test-png";

/**
 * Binario de prueba del wa-mock (media proxy del bot). La metadata del mock de
 * Graph apunta aquí como la "url" efímera del adjunto.
 *
 * 018 — También sirve los creativos de los anuncios simulados. Los ids que
 * empiezan por `creativo` devuelven un PNG real; algunos provocan a propósito
 * los caminos que la copia debe rechazar o reintentar.
 */
export const dynamic = "force-dynamic";

/** Veces que se ha pedido cada creativo, para simular fallos que se curan. */
const requests = new Map<string, number>();

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const guard = mockGuard();
  if (guard) return guard;
  const { id } = await ctx.params;

  if (id.startsWith("creativo")) {
    if (id === "creativo-enorme") {
      // Más grande que la cota de una miniatura.
      return new Response(new Uint8Array(400_000), {
        headers: { "content-type": "image/jpeg" },
      });
    }
    if (id === "creativo-svg") {
      // Un SVG servido desde nuestro origen podría ejecutar scripts.
      return new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', {
        headers: { "content-type": "image/svg+xml" },
      });
    }
    if (id === "creativo-redirige") {
      // Un salto hacia un origen que no es el permitido y que, si se siguiera,
      // SÍ devolvería un PNG: este mismo servidor por otro nombre (localhost ↔
      // 127.0.0.1). Así la prueba demuestra que el salto se revalida, y no que
      // el destino falló; y no sale de la máquina.
      const here = new URL(req.url);
      const other = here.hostname === "127.0.0.1" ? "localhost" : "127.0.0.1";
      return new Response(null, {
        status: 302,
        headers: {
          location: `${here.protocol}//${other}:${here.port}/api/dev/wa-mock/media-file/creativo-destino-del-salto`,
        },
      });
    }
    const time = (requests.get(id) ?? 0) + 1;
    requests.set(id, time);
    if (id.startsWith("creativo-lento") && time === 1) {
      // La primera vez tarda más que el tiempo de espera de la copia.
      await new Promise((r) => setTimeout(r, 6_500));
    }
    if (id.startsWith("creativo-falla") && time <= 2) {
      // Falla la copia y su reintento; a la tercera, ya responde.
      return new Response(null, { status: 503 });
    }
    return new Response(new Uint8Array(testPng(id)), {
      headers: { "content-type": "image/png" },
    });
  }

  const isPdf = id.includes("pdf");
  return new Response(Buffer.from("wa-mock-media"), {
    headers: {
      "content-type": isPdf ? "application/pdf" : "image/jpeg",
    },
  });
}
