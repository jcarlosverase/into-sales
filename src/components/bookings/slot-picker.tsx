"use client";

import { useEffect, useMemo, useState } from "react";
import { addDaysISO, time12 } from "@/lib/time/slots";
import { dayHeading, groupSlotsByDay, type DaySlot } from "@/lib/time/calendar";
import { cn } from "@/lib/utils";

/**
 * Los huecos libres por día, de toda la ventana del negocio: lo usan mover una
 * cita (215) y crearla a mano (1029). Consulta la disponibilidad solo al
 * abrirse, y cerrarlo cancela la consulta en vuelo.
 */
export function SlotPicker({
  today,
  busy,
  emptyMessage,
  selected,
  resourceId,
  onPick,
}: {
  today: string;
  busy: boolean;
  emptyMessage: string;
  /** El hueco marcado, para quien elige y confirma después. */
  selected?: string | null;
  /** 1029 — Solo los huecos de esta persona. */
  resourceId?: string | null;
  onPick: (slot: DaySlot) => void;
}) {
  const [slots, setSlots] = useState<DaySlot[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [day, setDay] = useState<string | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    let alive = true;
    void (async () => {
      const query = resourceId ? `?resourceId=${encodeURIComponent(resourceId)}` : "";
      const res = await fetch(`/api/calendar/availability${query}`, {
        signal: abort.signal,
      }).catch(() => null);
      if (!alive) return;
      if (!res?.ok) {
        setFailed(true);
        setSlots([]);
        return;
      }
      const data = (await res.json().catch(() => null)) as { slots: DaySlot[] } | null;
      if (alive) setSlots(data?.slots ?? []);
    })();
    return () => {
      alive = false;
      abort.abort();
    };
  }, [resourceId]);

  const days = useMemo(() => groupSlotsByDay(slots ?? []), [slots]);
  const current = day ?? days[0]?.[0] ?? null;
  const times = days.find(([d]) => d === current)?.[1] ?? [];

  return (
    <>
      {slots === null && <p className="text-sm text-text-3">Buscando huecos libres…</p>}
      {slots !== null && days.length === 0 && (
        <p className="text-sm text-text-3">
          {failed ? "No se pudo comprobar la disponibilidad. Intenta de nuevo." : emptyMessage}
        </p>
      )}

      {days.length > 0 && (
        <>
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label="Días con huecos">
            {days.map(([d, list]) => {
              const h = dayHeading(d);
              const prefix = d === today ? "Hoy" : d === addDaysISO(today, 1) ? "Mañana" : h.weekday;
              return (
                <button
                  key={d}
                  type="button"
                  data-day={d}
                  onClick={() => setDay(d)}
                  aria-pressed={d === current}
                  className={cn(
                    "flex shrink-0 flex-col items-center rounded-md border px-2.5 py-1.5 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft",
                    d === current ? "border-brand bg-brand-tint text-brand-text" : "hover:bg-accent"
                  )}
                >
                  <span className="text-[11px] font-medium first-letter:uppercase">{prefix}</span>
                  <span className="text-sm font-semibold tabular-nums">
                    {h.day} {h.month}
                  </span>
                  <span className="text-[10.5px] text-text-3">{list.length} libres</span>
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4" role="group" aria-label="Horarios libres">
            {times.map((s) => (
              <button
                key={s.startUtc}
                type="button"
                data-start={s.startUtc}
                disabled={busy}
                aria-pressed={selected === undefined ? undefined : selected === s.startUtc}
                onClick={() => onPick(s)}
                className={cn(
                  "rounded-md border px-1 py-1.5 font-mono text-[12.5px] transition-colors hover:border-brand hover:bg-brand-tint hover:text-brand-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft disabled:opacity-50",
                  selected === s.startUtc && "border-brand bg-brand-tint text-brand-text"
                )}
              >
                {time12(s.time)}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
