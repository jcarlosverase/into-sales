"use client";

import type { ReactNode } from "react";
import type { AdRowDto, AdsBlockDto, RateDto } from "@/lib/analytics";
import { originLabel, originHeadline } from "@/lib/ad-origin";
import { cn } from "@/lib/utils";
import { AdThumbnail } from "@/components/ad-origin";
import { Section, Subhead } from "./section";
import { RateCard, StatCard } from "./stat-card";

type Counts = { conversations: number; leads: number; won: number; winRate: RateDto };

/**
 * 019 — De dónde llegan: por origen y por anuncio, en conteos.
 *
 * Sin gasto, costo ni retorno (decisión del dueño): lo que se sabe de cada
 * anuncio es lo que Meta manda en el `referral` del webhook, que 018 ya
 * guarda. Contar no depende de ningún tercero.
 *
 * En el teléfono cada fila es una tarjeta con sus cuatro números a la vista:
 * una tabla de cinco columnas ahí esconde justo los números detrás de un
 * scroll lateral.
 */
export function AdsSection({
  data,
  loading,
  error,
}: {
  data: AdsBlockDto | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    <Section
      id="origen"
      title="Origen y anuncios"
      hint="Por dónde llegan las conversaciones y qué anuncio trae gente que compra."
      loading={loading}
      error={error}
      hasData={!!data}
      empty={!!data?.empty}
      emptyText="No empezó ninguna conversación en este periodo."
    >
      {data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:max-w-xl">
            <StatCard
              label="Conversaciones nuevas"
              value={String(data.conversations.current)}
              compare={data.conversations}
            />
            <RateCard
              label="Llegaron por un anuncio"
              rate={data.adShare}
              unit="conversaciones"
            />
          </div>

          <div>
            <Subhead>Por origen</Subhead>
            <Rows
              first="Origen"
              rows={data.sources.map((s) => ({
                key: s.value,
                title: <span className="font-medium">{s.label}</span>,
                counts: s,
              }))}
            />
          </div>

          <div>
            <Subhead>Por anuncio</Subhead>
            {data.ads.length === 0 ? (
              <p className="text-sm text-text-3">
                Ninguna conversación de este periodo llegó por un anuncio de Click a WhatsApp.
              </p>
            ) : (
              <Rows
                first="Anuncio"
                rows={data.ads.map((a) => ({
                  key: a.key,
                  title: <Ad ad={a} />,
                  counts: a,
                  sourceId: a.sourceId,
                }))}
              />
            )}
          </div>

          <div className="space-y-1 text-[11px] text-text-3">
            <p>
              «Ventas» son los prospectos del periodo que hoy están en Ganado; «Cierre» es
              ventas entre prospectos, atenuado con menos de 10 (muestra chica).
            </p>
            <p>
              El origen es el que capturaste en el contacto; si no hay, se deduce «Anuncio»
              cuando Meta dijo de qué anuncio llegó. Aquí solo se cuenta: el costo por
              prospecto y el retorno necesitarían el gasto de cada anuncio.
            </p>
          </div>
        </div>
      )}
    </Section>
  );
}

type Row = { key: string; title: ReactNode; counts: Counts; sourceId?: string | null };

/** La misma lista como tabla (desde `sm`) o como tarjetas (teléfono). */
function Rows({ first: first, rows: rows }: { first: string; rows: Row[] }) {
  return (
    <>
      <ul className="divide-y border-y text-sm sm:hidden">
        {rows.map((f) => (
          <li key={f.key} className="py-2.5" data-anuncio={f.sourceId ?? undefined}>
            {f.title}
            <dl className="mt-2 grid grid-cols-4 gap-2 text-center">
              <Datum label="conversaciones" value={f.counts.conversations} />
              <Datum label="prospectos" value={f.counts.leads} />
              <Datum label="ventas" value={f.counts.won} />
              <div className="min-w-0">
                <dt className="sr-only">Cierre</dt>
                <dd className="text-sm font-semibold">
                  <ShortRate rate={f.counts.winRate} withDenominator={false} />
                </dd>
                <dd className="truncate text-[11px] text-text-3">
                  {f.counts.winRate.value === null ? "cierre" : `cierre de ${f.counts.winRate.sample}`}
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs text-text-3">
              <th scope="col" className="py-1.5 pr-2 text-left font-medium">
                {first}
              </th>
              <Num>Conversaciones</Num>
              <Num>Prospectos</Num>
              <Num>Ventas</Num>
              <Num>Cierre</Num>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.key} className="border-b last:border-0" data-anuncio={f.sourceId ?? undefined}>
                <td className="py-2 pr-3">{f.title}</td>
                <Cell>{f.counts.conversations}</Cell>
                <Cell>{f.counts.leads}</Cell>
                <Cell>{f.counts.won}</Cell>
                <Cell>
                  <ShortRate rate={f.counts.winRate} />
                </Cell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Ad({ ad: a }: { ad: AdRowDto }) {
  const headline = originHeadline(a.headline, a.sourceType);
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <AdThumbnail imageAssetId={a.imageAssetId} alt={`Creativo: ${headline}`} />
      <div className="min-w-0">
        <p className="truncate font-medium sm:max-w-[20rem]" title={headline}>
          {headline}
        </p>
        <p className="truncate text-[11px] text-text-3 sm:max-w-[20rem]">
          {originLabel(a.sourceType)}
          {a.sourceId && <span className="font-mono"> · {a.sourceId}</span>}
        </p>
      </div>
    </div>
  );
}

function Datum({ label: label, value: value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <dt className="sr-only">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums">{value}</dd>
      <dd className="truncate text-[11px] text-text-3" aria-hidden>
        {label}
      </dd>
    </div>
  );
}

function Num({ children }: { children: ReactNode }) {
  return (
    <th scope="col" className="py-1.5 pl-2 text-right font-medium">
      {children}
    </th>
  );
}

function Cell({ children }: { children: ReactNode }) {
  return <td className="py-2 pl-2 text-right tabular-nums">{children}</td>;
}

/**
 * La tasa de una fila: el porcentaje con su denominador, atenuada con muestra
 * chica (la nota al pie lo explica) para no ensanchar la columna.
 */
function ShortRate({ rate, withDenominator: withDenominator = true }: { rate: RateDto; withDenominator?: boolean }) {
  if (rate.value === null) return <span className="text-text-3">—</span>;
  return (
    <span
      className={cn(!rate.reliable && "text-text-3")}
      title={`${rate.value}% de ${rate.sample} prospectos${rate.reliable ? "" : " · muestra chica"}`}
    >
      {rate.value}%
      {withDenominator && <span className="ml-1 text-[11px] text-text-3">de {rate.sample}</span>}
    </span>
  );
}
