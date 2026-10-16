"use client";

import { addDaysISO } from "@/lib/time/slots";
import { cn } from "@/lib/utils";

export type Range = { from: string; to: string };

/**
 * 019 — Selector de rango. Los atajos cubren casi todas las consultas reales;
 * las fechas sueltas están para la excepción. Todo se interpreta en la zona
 * del negocio del lado del servidor: aquí solo viajan fechas de calendario.
 */
export function RangePicker({
  value,
  onChange,
  today,
  timezone,
}: {
  value: Range;
  onChange: (r: Range) => void;
  /** `YYYY-MM-DD` de hoy en la zona del negocio. */
  today: string;
  timezone: string;
}) {
  const shortcutsValue = shortcuts(today);
  const isActive = shortcutsValue.find(
    (a) => a.range.from === value.from && a.range.to === value.to
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Periodo">
        {shortcutsValue.map((a) => (
          <button
            key={a.label}
            type="button"
            aria-pressed={isActive?.label === a.label}
            onClick={() => onChange(a.range)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive?.label === a.label
                ? "border-brand bg-brand-tint text-brand-text"
                : "text-text-2 hover:bg-accent hover:text-foreground"
            )}
          >
            {a.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5 text-xs text-text-3">
        <input
          type="date"
          value={value.from}
          max={value.to}
          onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
          aria-label="Desde"
        />
        <span aria-hidden>a</span>
        <input
          type="date"
          value={value.to}
          min={value.from}
          onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
          aria-label="Hasta"
        />
      </div>
      <span className="text-[11px] text-text-3">Días de {timezone}</span>
    </div>
  );
}

/**
 * Los atajos se calculan sobre el "hoy" del NEGOCIO, que llega resuelto del
 * servidor: con la fecha del navegador, un dueño revisando de noche desde
 * otra zona pediría un rango que no es el suyo, y el servidor y el cliente
 * pintarían atajos distintos en el primer render.
 */
export function shortcuts(todayValue: string): { label: string; range: Range }[] {
  const less = (n: number) => addDaysISO(todayValue, -n);
  const firstOfMonth = `${todayValue.slice(0, 8)}01`;
  const lastMonthEnd = addDaysISO(firstOfMonth, -1);
  const lastMonthStart = `${lastMonthEnd.slice(0, 8)}01`;

  return [
    { label: "7 días", range: { from: less(6), to: todayValue } },
    { label: "30 días", range: { from: less(29), to: todayValue } },
    { label: "Este mes", range: { from: firstOfMonth, to: todayValue } },
    { label: "Mes pasado", range: { from: lastMonthStart, to: lastMonthEnd } },
    { label: "90 días", range: { from: less(89), to: todayValue } },
  ];
}

/** El rango por defecto: últimos 30 días. */
export function defaultRange(todayValue: string): Range {
  return shortcuts(todayValue)[1]!.range;
}
