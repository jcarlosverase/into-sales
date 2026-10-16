"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ATTENTION_DAYS, DAY_LABELS, type AttentionDay, type AttentionHours } from "@/lib/attention";
import { cn } from "@/lib/utils";

/**
 * 031 — Cuándo responde la IA: siempre, o solo fuera del horario de atención
 * del equipo. Un tramo por día en esta pantalla (la API acepta hasta cuatro).
 */

export type ReplyMode = "always" | "outside_hours";

const ZONES = [
  "America/Lima",
  "America/Mexico_City",
  "America/Bogota",
  "America/Santiago",
  "America/Argentina/Buenos_Aires",
  "America/Guayaquil",
  "America/La_Paz",
  "America/Caracas",
  "America/New_York",
  "Europe/Madrid",
];

export function AttentionSection({
  replyMode,
  hours,
  timezone,
  attentionNow,
  agentEnabled,
  onSave,
}: {
  replyMode: ReplyMode;
  hours: AttentionHours;
  timezone: string;
  attentionNow: boolean;
  agentEnabled: boolean;
  onSave: (patch: { replyMode?: ReplyMode; attentionHours?: AttentionHours; attentionTimezone?: string }) => Promise<void>;
}) {
  const [draft, setDraft] = useState<AttentionHours>(hours);
  const [zone, setZone] = useState(timezone);
  useEffect(() => setDraft(hours), [hours]);
  useEffect(() => setZone(timezone), [timezone]);

  const setDay = (day: AttentionDay, next: { start: string; end: string } | null) =>
    setDraft((d) => ({ ...d, [day]: next ? [next] : [] }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(hours) || zone !== timezone;
  const invalid = ATTENTION_DAYS.some((d) => (draft[d] ?? []).some((i) => !(i.start < i.end)));

  return (
    <Card className="lg:col-span-2" data-testid="attention-section">
      <CardHeader>
        <CardTitle>Cuándo responde la IA</CardTitle>
        <CardDescription>
          Para que el equipo atienda en persona durante el día y la IA cubra las noches y los fines de semana.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div role="radiogroup" aria-label="Cuándo responde la IA" className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ["always", "Siempre", "La IA contesta a cualquier hora."],
              ["outside_hours", "Solo fuera del horario de atención", "Dentro del horario contesta el equipo; la IA calla."],
            ] as const
          ).map(([value, label, hint]) => (
            <label
              key={value}
              className={cn(
                "flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm",
                replyMode === value && "border-brand bg-brand-tint"
              )}
            >
              <input
                type="radio"
                name="reply-mode"
                value={value}
                checked={replyMode === value}
                onChange={() => void onSave({ replyMode: value })}
                className="mt-0.5 accent-primary"
              />
              <span>
                <span className="block font-medium">{label}</span>
                <span className="block text-xs text-text-3">{hint}</span>
              </span>
            </label>
          ))}
        </div>

        {replyMode === "outside_hours" ? (
          <p className="text-sm" data-testid="attention-now">
            {!agentEnabled
              ? "El agente está apagado: no contesta a ninguna hora."
              : attentionNow
                ? "Ahora es horario de atención: contesta el equipo."
                : "Ahora está fuera del horario de atención: contesta la IA."}
          </p>
        ) : null}

        <div className="space-y-2">
          <p className="kicker">Horario de atención del equipo</p>
          <ul className="divide-y rounded-md border">
            {ATTENTION_DAYS.map((day) => {
              const interval = draft[day]?.[0] ?? null;
              return (
                <li key={day} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 text-sm">
                  <label className="flex w-32 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!interval}
                      onChange={(e) => setDay(day, e.target.checked ? { start: "09:00", end: "18:00" } : null)}
                      className="accent-primary"
                      aria-label={`Atiende el ${DAY_LABELS[day].toLowerCase()}`}
                    />
                    {DAY_LABELS[day]}
                  </label>
                  {interval ? (
                    <span className="flex items-center gap-1.5">
                      <input
                        type="time"
                        aria-label={`${DAY_LABELS[day]}: desde`}
                        value={interval.start}
                        onChange={(e) => setDay(day, { ...interval, start: e.target.value })}
                        className="h-8 rounded-md border border-input bg-card px-2 text-sm"
                      />
                      <span className="text-text-3">a</span>
                      <input
                        type="time"
                        aria-label={`${DAY_LABELS[day]}: hasta`}
                        value={interval.end === "24:00" ? "23:59" : interval.end}
                        onChange={(e) => setDay(day, { ...interval, end: e.target.value })}
                        className="h-8 rounded-md border border-input bg-card px-2 text-sm"
                      />
                    </span>
                  ) : (
                    <span className="text-xs text-text-3">Sin atención: la IA contesta todo el día</span>
                  )}
                </li>
              );
            })}
          </ul>
          <label className="flex flex-wrap items-center gap-2 text-sm">
            <span>Zona horaria</span>
            <select
              value={zone}
              onChange={(e) => setZone(e.target.value)}
              aria-label="Zona horaria del horario de atención"
              className="h-9 max-w-full rounded-md border border-input bg-card px-2 text-sm"
            >
              {[...new Set([zone, ...ZONES])].map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </label>
          {invalid ? <p className="text-xs text-danger-text">En cada día, «desde» va antes que «hasta».</p> : null}
          <Button size="sm" disabled={!dirty || invalid} onClick={() => void onSave({ attentionHours: draft, attentionTimezone: zone })}>
            Guardar horario
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
