"use client";

import type { StampCardBlockDto } from "@/lib/analytics";
import { Section } from "./section";
import { StatCard } from "./stat-card";

/**
 * 1023, AC12 — La tarjeta de sellos en Resultados: si trae clientes de
 * vuelta. Cada número va contra el periodo anterior.
 */
export function StampCardSection({
  data,
  loading,
  error,
}: {
  data: StampCardBlockDto | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    <Section
      id="tarjeta-de-sellos"
      title="Tarjeta de sellos"
      hint="Clientes que volvieron: dos sellos o más en el periodo. «En un wallet» es lo de ahora."
      loading={loading}
      error={error}
      hasData={!!data}
      empty={data?.empty}
      emptyText="Todavía nadie tiene tarjeta. Ponla en Ajustes → Tarjeta de sellos y deja el cartel en el mostrador."
    >
      {data && (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
          <StatCard label="Tarjetas nuevas" value={String(data.newCards.current)} compare={data.newCards} />
          <StatCard label="Sellos" value={String(data.stamps.current)} compare={data.stamps} />
          <StatCard label="Canjes" value={String(data.redeems.current)} compare={data.redeems} />
          <StatCard label="Clientes que volvieron" value={String(data.returning.current)} compare={data.returning} />
          <StatCard
            label="En un wallet"
            value={String(data.inWallet)}
            hint={`de ${data.totalCards} tarjeta${data.totalCards === 1 ? "" : "s"}`}
          />
        </div>
      )}
    </Section>
  );
}
