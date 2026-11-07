"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import type { DaySlot } from "@/lib/time/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SELECT_CLASS, type ResourceOption } from "./booking-look";
import { SlotPicker } from "./slot-picker";

/**
 * 1029 — Crear una cita a mano: eliges con quién (un contacto que puedes ver)
 * y uno de los huecos libres. Sigue las reglas de siempre: el servidor revisa
 * que el hueco siga libre y la cita aparece en el calendario. No le escribe al
 * contacto.
 */

type ContactOption = { id: string; name: string | null; phone: string | null };

const MAX_RESULTS = 6;

function contactLabel(c: ContactOption): string {
  return c.name?.trim() || c.phone || "Sin nombre";
}

export function NewBookingDialog({
  today,
  timezone,
  resources,
  initialResourceId,
  onCancel,
  onCreated,
}: {
  today: string;
  timezone: string;
  resources: ResourceOption[];
  initialResourceId: string | null;
  onCancel: () => void;
  onCreated: (day: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ContactOption[] | null>(null);
  const [contact, setContact] = useState<ContactOption | null>(null);
  const [slot, setSlot] = useState<DaySlot | null>(null);
  // 1029 — Vacío: el primero libre. Con una sola persona no se pregunta.
  const [resourceId, setResourceId] = useState(initialResourceId ?? "");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Un hueco que se ocupó en el camino: se vuelve a pedir la disponibilidad.
  const [slotsVersion, setSlotsVersion] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  useEffect(() => {
    const q = query.trim();
    if (contact || !q) {
      setResults(null);
      return;
    }
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        const res = await fetch(`/api/contacts?q=${encodeURIComponent(q)}`, {
          signal: abort.signal,
        }).catch(() => null);
        if (abort.signal.aborted) return;
        const data = (await res?.json().catch(() => null)) as { contacts?: ContactOption[] } | null;
        setResults((data?.contacts ?? []).slice(0, MAX_RESULTS));
      })();
    }, 250);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query, contact]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!contact || !slot) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "session",
        contactId: contact.id,
        startUtc: slot.startUtc,
        resourceId: resourceId || null,
        notes: notes.trim() || null,
      }),
    }).catch(() => null);
    setBusy(false);
    if (res?.status !== 201) {
      const data = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(data?.error?.message ?? "No se pudo crear la cita");
      setSlot(null);
      setSlotsVersion((v) => v + 1);
      return;
    }
    onCreated(slot.dayIso);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-booking-title"
      onClick={onCancel}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="max-h-full w-full max-w-md space-y-4 overflow-y-auto rounded-lg border bg-popover p-5 shadow-pop"
      >
        <div>
          <h3 id="new-booking-title" className="text-[16px] font-bold">
            Nueva cita
          </h3>
          <p className="mt-1 text-sm text-text-3">
            La cita queda en el calendario. El contacto no recibe un mensaje automático.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="booking-contact">Contacto</Label>
          {contact ? (
            <div className="flex items-center justify-between gap-2 rounded-md border bg-secondary px-3 py-2 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <Check className="h-4 w-4 shrink-0 text-brand-text" />
                <span className="truncate font-medium">{contactLabel(contact)}</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  setContact(null);
                  setQuery("");
                }}
                className="shrink-0 text-xs font-medium text-text-3 hover:text-foreground"
              >
                Cambiar
              </button>
            </div>
          ) : (
            <>
              <Input
                id="booking-contact"
                autoFocus
                autoComplete="off"
                value={query}
                placeholder="Nombre o teléfono"
                onChange={(e) => setQuery(e.target.value)}
              />
              {results !== null && results.length === 0 && (
                <p className="text-sm text-text-3">No hay contactos con ese nombre o teléfono.</p>
              )}
              {results !== null && results.length > 0 && (
                <ul className="divide-y rounded-md border" aria-label="Contactos encontrados">
                  {results.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => setContact(c)}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft"
                      >
                        <span className="truncate font-medium">{contactLabel(c)}</span>
                        {c.name && c.phone && (
                          <span className="shrink-0 font-mono text-xs text-text-3">{c.phone}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        {resources.length >= 2 && (
          <div className="space-y-1.5">
            <Label htmlFor="booking-resource">Con quién atiende</Label>
            <select
              id="booking-resource"
              value={resourceId}
              onChange={(e) => {
                setResourceId(e.target.value);
                setSlot(null);
              }}
              className={SELECT_CLASS}
            >
              <option value="">Primero libre</option>
              {resources.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-sm font-medium">Cuándo</p>
          <SlotPicker
            key={`${resourceId}-${slotsVersion}`}
            resourceId={resourceId || null}
            today={today}
            busy={busy}
            emptyMessage="No hay huecos libres. Revisa el horario en Ajustes → Agenda."
            selected={slot?.startUtc ?? null}
            onPick={setSlot}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="booking-notes">Nota (opcional)</Label>
          <Input
            id="booking-notes"
            value={notes}
            maxLength={120}
            placeholder="Primera consulta"
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <p className="text-xs text-text-3">Hora de la zona del negocio ({timezone}).</p>

        {error && (
          <p role="alert" className="text-sm text-danger-text">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" disabled={busy || !contact || !slot}>
            {busy ? "Creando…" : "Crear cita"}
          </Button>
        </div>
      </form>
    </div>
  );
}
