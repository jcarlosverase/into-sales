import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadPublicCard } from "@/server/stamp-card/public";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }> };

export const metadata: Metadata = {
  title: "Privacidad de tu tarjeta de sellos",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

/** 1023, D13 — Qué datos usa la tarjeta, para qué y cómo pedir que se borren (Ley 29733). */
export default async function StampCardPrivacyPage({ params }: Props) {
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
  const business = result.card.branding.name;
  return (
    <article className="space-y-4 text-sm">
      <h1 className="text-lg font-bold">Privacidad de tu tarjeta de sellos</h1>
      <section className="space-y-1">
        <h2 className="font-semibold">Quién usa tus datos</h2>
        <p>{business} es responsable de los datos de tu tarjeta.</p>
      </section>
      <section className="space-y-1">
        <h2 className="font-semibold">Qué datos y para qué</h2>
        <p>
          Tu nombre y tu número de WhatsApp, y tus sellos, canjes y fechas. Se usan solo para llevar tu tarjeta,
          reconocerte en cada visita y entregarte tu premio.
        </p>
      </section>
      <section className="space-y-1">
        <h2 className="font-semibold">Si la guardas en tu celular</h2>
        <p>
          La tarjeta se guarda en Apple Wallet o Google Wallet, bajo las condiciones de Apple o Google. Lleva tus
          sellos y un código al azar, nunca tu nombre ni tu teléfono. into, la empresa que da este sistema a{" "}
          {business}, firma la tarjeta para que tu celular la acepte y tampoco recibe tu nombre, tu teléfono ni tus
          conversaciones.
        </p>
      </section>
      <section className="space-y-1">
        <h2 className="font-semibold">Cuánto tiempo y tus derechos</h2>
        <p>
          Tus datos se guardan mientras tengas la tarjeta. Puedes pedir verlos, corregirlos o borrarlos, u oponerte a
          su uso, escribiendo a {business} por WhatsApp. Puedes quitar la tarjeta de tu celular cuando quieras.
        </p>
      </section>
      <Link href={`/c/${token}`} className="inline-block font-medium underline underline-offset-2">
        Volver a mi tarjeta
      </Link>
    </article>
  );
}
