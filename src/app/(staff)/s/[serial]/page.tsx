import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { StampCardPanel } from "@/components/stamp-card/stamp-card-panel";
import { canConfigure } from "@/lib/auth/roles";
import { getSessionOrNull } from "@/lib/auth/session";
import { getCardBySerial } from "@/server/stamp-card/cards";
import { stampCardEnabled } from "@/server/stamp-card/flag";
import { cardView } from "@/server/stamp-card/http";
import { SERIAL_PATTERN } from "@/server/stamp-card/tokens";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Sumar sello", robots: { index: false, follow: false } };

type Props = { params: Promise<{ serial: string }> };

/**
 * 1023, D6 y AC7 — Lo que abre el QR de la tarjeta del cliente. Sin la
 * bandera, 404. Sin sesión, a «Entrar» sin mostrar nada, y de vuelta aquí.
 * Con sesión, la tarjeta en grande con «+ Sumar sello» y «Canjear premio».
 */
export default async function StaffStampPage({ params }: Props) {
  if (!stampCardEnabled()) notFound();
  const { serial } = await params;
  const session = await getSessionOrNull();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/s/${serial}`)}`);
  if (!SERIAL_PATTERN.test(serial)) notFound();
  const card = await getCardBySerial(session.organizationId, serial);
  if (!card) notFound();
  const view = await cardView(session.organizationId, card, { withEvents: true });
  return (
    <>
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="min-w-0 truncate text-lg font-bold tracking-tight">{view.contactName || "Cliente"}</h1>
        <Link href="/inbox" className="shrink-0 text-sm text-primary underline-offset-2 hover:underline">
          Ir al CRM
        </Link>
      </header>
      <StampCardPanel
        initial={view}
        contactId={view.contactId}
        canAdjust={canConfigure(session.role)}
        source="qr"
        variant="full"
      />
    </>
  );
}
