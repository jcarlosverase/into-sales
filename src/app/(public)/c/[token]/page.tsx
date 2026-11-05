import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { BrandTile } from "@/components/brand-mark";
import { StampCardFace } from "@/components/stamp-card/card-face";
import { qrSvg } from "@/lib/qr";
import { loadPublicCard } from "@/server/stamp-card/public";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }> };

/** D5 — Nunca en un buscador, y el token no sale en el Referer. */
export const metadata: Metadata = {
  title: "Tu tarjeta de sellos",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

/**
 * 1023, H3 — La tarjeta del cliente, sin sesión: negocio, sellos, premio y
 * el QR que el equipo escanea para sellar. Sin wallet, esta página es la
 * tarjeta (D9).
 */
export default async function PublicStampCardPage({ params }: Props) {
  const { token } = await params;
  const result = await loadPublicCard(token, await headers());
  if (result.kind === "not_found") notFound();
  if (result.kind === "rate_limited") {
    return (
      <p role="alert" className="rounded-xl border p-4 text-sm">
        Demasiadas consultas seguidas. Espera un minuto y vuelve a abrir el enlace.
      </p>
    );
  }
  const { card } = result;
  return (
    <>
      <StampCardFace
        name={card.name}
        reward={card.reward}
        color={card.color}
        stamps={card.stamps}
        stampsRequired={card.stampsRequired}
        paused={card.paused}
        logo={<BrandTile branding={card.branding} className="h-10 w-10 rounded-xl bg-white text-lg" />}
      />

      <figure className="flex flex-col items-center gap-2 rounded-2xl border bg-card p-4">
        <div
          className="w-52 max-w-full"
          // SVG generado aquí mismo a partir de una URL propia: no hay entrada del usuario.
          dangerouslySetInnerHTML={{ __html: qrSvg(card.staffUrl) }}
        />
        <figcaption className="text-center text-sm text-muted-foreground">
          Muestra este código en caja para sumar tu sello.
        </figcaption>
      </figure>

      {card.rewardsRedeemed > 0 ? (
        <p className="text-center text-sm text-muted-foreground">
          Premios canjeados: <span className="font-semibold text-foreground">{card.rewardsRedeemed}</span>
        </p>
      ) : null}
      {card.terms ? <p className="text-center text-xs text-muted-foreground">{card.terms}</p> : null}
      <p className="text-center text-xs text-muted-foreground">
        Guarda este enlace o agrégalo a tu pantalla de inicio para tenerla a mano.
      </p>
    </>
  );
}
