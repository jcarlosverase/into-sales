import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Wallet } from "lucide-react";
import { BrandTile } from "@/components/brand-mark";
import { StampCardFace } from "@/components/stamp-card/card-face";
import { qrSvg } from "@/lib/qr";
import { walletPlatform, type WalletPlatform } from "@/lib/stamp-card";
import { loadPublicCard, type PublicCard } from "@/server/stamp-card/public";

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
  const requestHeaders = await headers();
  const result = await loadPublicCard(token, requestHeaders);
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

      <WalletButtons
        token={token}
        wallet={card.wallet}
        consented={card.consented}
        business={card.branding.name}
        platform={walletPlatform(requestHeaders.get("user-agent"))}
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
      <p className="text-center text-xs">
        <Link href={`/c/${token}/privacy`} className="text-muted-foreground underline underline-offset-2">
          Privacidad
        </Link>
      </p>
    </>
  );
}

/**
 * AC8 y AC10 — Los botones de wallet: solo con el central y un plan con
 * wallet. Con el central caído, se dice en vez de ofrecer algo que falla.
 * En el celular, solo el de su sistema; en una computadora, los dos.
 * D13 — Antes de guardarla, el cliente acepta: la página sin wallet no lo pide.
 */
function WalletButtons({
  token,
  wallet,
  consented,
  business,
  platform,
}: {
  token: string;
  wallet: PublicCard["wallet"];
  consented: boolean;
  business: string;
  platform: WalletPlatform;
}) {
  const apple = platform === "android" ? "hidden" : wallet.apple;
  const google = platform === "ios" ? "hidden" : wallet.google;
  const offers = [
    apple === "available" ? { href: `/c/${token}/apple`, label: "Agregar a Apple Wallet" } : null,
    google === "available" ? { href: `/c/${token}/google`, label: "Guardar en Google Wallet" } : null,
  ].filter((o): o is { href: string; label: string } => o !== null);
  const down = apple === "unavailable" || google === "unavailable";
  if (offers.length === 0 && !down) return null;
  if (offers.length > 0 && !consented) {
    return (
      <form method="post" action={`/c/${token}/consent`} className="space-y-3 rounded-2xl border bg-card p-4" data-testid="stamp-consent">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="accept" required className="mt-0.5 h-4 w-4 shrink-0 accent-black" />
          <span>
            Acepto que {business} use mi nombre, mi número de WhatsApp y mis sellos para llevar esta tarjeta en mi
            celular.{" "}
            <Link href={`/c/${token}/privacy`} className="underline underline-offset-2">
              Ver privacidad
            </Link>
          </span>
        </label>
        <button type="submit" className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-black px-4 text-sm font-semibold text-white">
          <Wallet className="h-5 w-5" aria-hidden="true" />
          Aceptar y guardar en mi celular
        </button>
      </form>
    );
  }
  return (
    <div className="space-y-2">
      {offers.map((o) => (
        <a
          key={o.href}
          href={o.href}
          rel="nofollow noreferrer"
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-black px-4 text-sm font-semibold text-white"
        >
          <Wallet className="h-5 w-5" aria-hidden="true" />
          {o.label}
        </a>
      ))}
      {down ? (
        <p className="text-center text-xs text-muted-foreground">
          Guardarla en tu wallet no está disponible en este momento. Tu tarjeta funciona igual en esta página.
        </p>
      ) : null}
    </div>
  );
}
