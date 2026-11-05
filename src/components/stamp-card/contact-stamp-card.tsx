"use client";

import { useEffect, useState } from "react";
import type { CardView } from "@/server/stamp-card/http";
import { StampCardPanel } from "./stamp-card-panel";

type Loaded = { card: CardView | null; canAdjust: boolean };

/**
 * 1023, AC14 — La tarjeta de sellos en la ficha del contacto (cajón del trato
 * y Bandeja). Pregunta a la API: con la bandera apagada responde 404 y la
 * sección no existe; sin programa todavía, tampoco se muestra.
 */
export function ContactStampCard({ contactId, className }: { contactId: string; className?: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [hasProgram, setHasProgram] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoaded(null);
    void (async () => {
      const res = await fetch(`/api/stamp-card/cards?contactId=${encodeURIComponent(contactId)}`, { cache: "no-store" }).catch(() => null);
      if (!alive || !res?.ok) return;
      const data = (await res.json()) as Loaded;
      if (data.card) {
        setHasProgram(true);
        setLoaded(data);
        return;
      }
      const program = await fetch("/api/stamp-card/program", { cache: "no-store" }).catch(() => null);
      if (!alive || !program?.ok) return;
      setHasProgram(!!((await program.json()) as { program: unknown }).program);
      setLoaded(data);
    })();
    return () => {
      alive = false;
    };
  }, [contactId]);

  if (!loaded || !hasProgram) return null;
  return (
    <section className={className ?? "border-b p-4"} aria-label="Tarjeta de sellos">
      <p className="kicker mb-2">Tarjeta de sellos</p>
      <StampCardPanel key={contactId} initial={loaded.card} contactId={contactId} canAdjust={loaded.canAdjust} />
    </section>
  );
}
