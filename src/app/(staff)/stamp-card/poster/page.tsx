import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getSessionOrNull } from "@/lib/auth/session";
import { stampCardEnabled } from "@/server/stamp-card/flag";
import { posterData } from "@/server/stamp-card/poster";
import { PrintButton } from "@/components/stamp-card/print-button";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Cartel del mostrador", robots: { index: false, follow: false } };

/**
 * 1023, AC13 — El cartel del mostrador para imprimir o guardar en PDF desde
 * el navegador (sin dependencia de PDF). Mismo contenido que el PNG.
 */
export default async function PosterPage() {
  if (!stampCardEnabled()) notFound();
  const session = await getSessionOrNull();
  if (!session) redirect(`/login?next=${encodeURIComponent("/stamp-card/poster")}`);
  const poster = await posterData(session.organizationId);
  if (!poster) {
    return <p className="text-sm text-muted-foreground">Guarda la tarjeta y conecta tu número de WhatsApp para generar el cartel.</p>;
  }
  return (
    <>
      <style>{"@media print { @page { size: A5 portrait; margin: 0 } .no-print { display: none !important } body { print-color-adjust: exact; -webkit-print-color-adjust: exact } }"}</style>
      <PrintButton />
      <article
        className="flex aspect-[3/4] w-full flex-col items-center justify-between rounded-2xl p-6 text-center print:rounded-none"
        style={{ backgroundColor: poster.color, color: poster.ink }}
      >
        <header>
          <h1 className="text-2xl font-bold">{poster.name}</h1>
          <p className="mt-2 text-base">
            Junta {poster.stampsRequired} sellos y llévate {poster.reward}
          </p>
        </header>
        <div
          className="w-3/4 rounded-xl bg-white p-2"
          // SVG generado por el CRM a partir de su propio enlace.
          dangerouslySetInnerHTML={{ __html: poster.qrSvg }}
        />
        <footer>
          <p className="text-sm">Escanea y envía por WhatsApp:</p>
          <p className="mt-1 text-lg font-bold">«{poster.phrase}»</p>
        </footer>
      </article>
    </>
  );
}
