"use client";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * 015 → 1029 — El horario semanal, en una pieza: lo usan el negocio y cada
 * profesional. Las horas son de pared; un día sin franjas está cerrado.
 */

export type Interval = { start: string; end: string };
export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type WeeklyHours = Partial<Record<DayKey, Interval[]>>;

const DAYS: { key: DayKey; label: string }[] = [
  { key: "mon", label: "Lunes" },
  { key: "tue", label: "Martes" },
  { key: "wed", label: "Miércoles" },
  { key: "thu", label: "Jueves" },
  { key: "fri", label: "Viernes" },
  { key: "sat", label: "Sábado" },
  { key: "sun", label: "Domingo" },
];

const DEFAULT_INTERVAL: Interval = { start: "09:00", end: "18:00" };

export function WeeklyHoursEditor({
  value,
  onChange,
}: {
  value: WeeklyHours;
  onChange: (next: WeeklyHours) => void;
}) {
  function toggleDay(day: DayKey) {
    const current = value[day];
    const next = { ...value };
    if (current && current.length > 0) delete next[day];
    else next[day] = [{ ...DEFAULT_INTERVAL }];
    onChange(next);
  }

  function setIntervalAt(day: DayKey, index: number, patch: Partial<Interval>) {
    const intervals = [...(value[day] ?? [])];
    const current = intervals[index];
    if (!current) return;
    intervals[index] = { ...current, ...patch };
    onChange({ ...value, [day]: intervals });
  }

  function addInterval(day: DayKey) {
    const intervals = [...(value[day] ?? [])];
    intervals.push({ start: "16:00", end: "18:00" });
    onChange({ ...value, [day]: intervals });
  }

  function removeInterval(day: DayKey, index: number) {
    const intervals = (value[day] ?? []).filter((_, i) => i !== index);
    const next = { ...value };
    if (intervals.length === 0) delete next[day];
    else next[day] = intervals;
    onChange(next);
  }

  return (
    <>
      {DAYS.map((day) => {
        const intervals = value[day.key] ?? [];
        const open = intervals.length > 0;
        return (
          <div key={day.key} className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
            <button
              type="button"
              onClick={() => toggleDay(day.key)}
              className={cn(
                "w-24 shrink-0 rounded-sm px-2 py-1 text-left text-sm font-medium transition-colors sm:mt-1",
                open ? "bg-brand-tint text-brand-text" : "text-text-3 hover:bg-accent"
              )}
            >
              {day.label}
            </button>
            <div className="flex-1 space-y-1.5">
              {!open && <span className="text-sm text-text-3">Cerrado</span>}
              {intervals.map((iv, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    type="time"
                    value={iv.start}
                    onChange={(e) => setIntervalAt(day.key, i, { start: e.target.value })}
                    className="min-w-0 flex-1 sm:w-36 sm:flex-none"
                  />
                  <span className="text-text-3">a</span>
                  <Input
                    type="time"
                    value={iv.end}
                    onChange={(e) => setIntervalAt(day.key, i, { end: e.target.value })}
                    className="min-w-0 flex-1 sm:w-36 sm:flex-none"
                  />
                  <button
                    type="button"
                    onClick={() => removeInterval(day.key, i)}
                    className="text-sm text-text-3 hover:text-foreground"
                    aria-label="Quitar franja"
                  >
                    ×
                  </button>
                </div>
              ))}
              {open && (
                <button
                  type="button"
                  onClick={() => addInterval(day.key)}
                  className="text-xs text-brand-text hover:underline"
                >
                  + otra franja
                </button>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
