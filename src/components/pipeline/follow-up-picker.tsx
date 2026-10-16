"use client";

import { useEffect, useState } from "react";
import { addDays } from "@/lib/today";
import { cn } from "@/lib/utils";

/**
 * 029 — Próximo contacto de un trato: el día y una nota corta. Los atajos
 * cuentan desde HOY DEL NEGOCIO (`today`, que manda el servidor), no desde el
 * reloj del navegador.
 */
export function FollowUpPicker({
  value,
  note,
  today,
  onChange,
}: {
  value: string | null;
  note: string | null;
  today: string | null;
  onChange: (next: { followUpOn: string | null; followUpNote: string | null }) => void;
}) {
  const [draftNote, setDraftNote] = useState(note ?? "");
  useEffect(() => setDraftNote(note ?? ""), [note]);
  const shortcuts = today
    ? [
        { label: "Mañana", value: addDays(today, 1) },
        { label: "En 3 días", value: addDays(today, 3) },
        { label: "En una semana", value: addDays(today, 7) },
      ]
    : [];
  const save = (followUpOn: string | null) => onChange({ followUpOn, followUpNote: followUpOn ? draftNote.trim() || null : null });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {shortcuts.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => save(s.value)}
            aria-pressed={value === s.value}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              value === s.value ? "border-brand bg-brand-tint text-brand-text" : "hover:bg-accent"
            )}
          >
            {s.label}
          </button>
        ))}
        <input
          type="date"
          aria-label="Fecha del próximo contacto"
          value={value ?? ""}
          onChange={(e) => save(e.target.value || null)}
          className="h-8 rounded-md border border-input bg-card px-2 text-xs"
        />
        {value ? (
          <button type="button" onClick={() => save(null)} className="text-xs text-text-3 hover:text-foreground">
            Quitar
          </button>
        ) : null}
      </div>
      {value ? (
        <input
          type="text"
          aria-label="Nota del próximo contacto"
          placeholder="Nota (opcional): p. ej. pide precio del curso de verano"
          maxLength={200}
          value={draftNote}
          onChange={(e) => setDraftNote(e.target.value)}
          onBlur={() => draftNote.trim() !== (note ?? "") && onChange({ followUpOn: value, followUpNote: draftNote.trim() || null })}
          className="h-8 w-full rounded-md border border-input bg-card px-2 text-xs"
        />
      ) : (
        <p className="text-xs text-text-3">Sin fecha: no aparece en «Hoy» como seguimiento.</p>
      )}
    </div>
  );
}
