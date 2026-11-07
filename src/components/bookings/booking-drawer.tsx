"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, MessageSquareText, Sparkles, Video, X } from "lucide-react";
import { bookingSegments, clock12, longDayLabel } from "@/lib/time/calendar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  SELECT_CLASS,
  bookingTitle,
  bookingTone,
  canRetrySync,
  statusLabel,
  type Booking,
  type ResourceOption,
} from "./booking-look";
import { SlotPicker } from "./slot-picker";

/**
 * 215 — La cita, abierta, sin salir del calendario. Tiene TODO lo que tenía la
 * tarjeta de la lista de antes (acciones, enlace, notas y el reintento del
 * enlace): el calendario cambia cómo se ve la agenda, no lo que se puede hacer
 * con ella.
 */

export type ActResult = { ok: true } | { ok: false; message: string };

export function BookingDrawer({
  booking: b,
  timezone,
  today,
  resources,
  nowMs,
  onClose,
  onAct,
  onRescheduled,
}: {
  booking: Booking;
  timezone: string;
  today: string;
  resources: ResourceOption[];
  nowMs: number;
  onClose: () => void;
  /** PATCH a la cita; devuelve el error del servidor si lo hay. */
  onAct: (body: Record<string, unknown>) => Promise<ActResult>;
  /** La cita se movió: el calendario salta a su día nuevo. */
  onRescheduled: (startUtc: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState(false);

  // Otra cita, otro panel: ni el error ni el selector de horarios se heredan.
  useEffect(() => {
    setError(null);
    setRescheduling(false);
  }, [b.id]);

  // Escape cierra: el mismo gesto que el cajón del Pipeline.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function run(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    const result = await onAct(body);
    setBusy(false);
    if (!result.ok) setError(result.message);
    return result.ok;
  }

  const segments = bookingSegments(b.scheduledAtUtc, b.durationMinutes, timezone);
  const first = segments[0];
  const last = segments[segments.length - 1];
  const isSession = b.kind === "session";
  const active = b.status === "agendada";
  const endMs = Date.parse(b.scheduledAtUtc) + b.durationMinutes * 60_000;
  const tone = bookingTone(b);

  return (
    <>
      {/* Velo solo en el celular, donde el panel tapa todo. En escritorio el
          panel es lateral y NO modal, como el detalle de Google: tocar otra
          cita del calendario cambia el panel sin cerrarlo primero. */}
      <button
        aria-label="Cerrar la cita"
        tabIndex={-1}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-overlay md:hidden"
      />

      <aside
        role="dialog"
        aria-label={`${isSession ? "Cita" : "Bloqueo"}: ${bookingTitle(b)}`}
        className="fixed inset-y-0 right-0 z-50 flex w-[min(400px,94vw)] flex-col border-l bg-popover shadow-pop lg:static lg:z-auto lg:w-[360px] lg:shrink-0 lg:shadow-none"
      >
        <header className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="kicker text-text-2">{isSession ? "Cita" : "Bloqueo de horario"}</h3>
          <button
            autoFocus
            onClick={onClose}
            aria-label="Cerrar el panel de la cita"
            className="rounded p-1 text-text-3 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-soft"
          >
            <X className="h-4 w-4" strokeWidth={1.7} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {/* Qué y cuándo */}
          <section className="space-y-3 border-b p-4">
            <div className="flex items-start gap-3">
              <span aria-hidden className={cn("mt-1.5 h-3 w-3 shrink-0 rounded-full", tone.dot)} />
              <div className="min-w-0">
                <p
                  className={cn(
                    "text-[17px] font-bold leading-snug",
                    b.status === "cancelada" && "text-text-3 line-through"
                  )}
                >
                  {bookingTitle(b)}
                </p>
                {first && last && (
                  <p className="mt-0.5 text-sm text-text-2 first-letter:uppercase">
                    {longDayLabel(first.day)} · {clock12(first.startMin)} – {clock12(last.endMin)}
                    {last.day !== first.day && " del día siguiente"}
                  </p>
                )}
                <p className="text-xs text-text-3">
                  {b.durationMinutes} min · {timezone}
                </p>
                {b.resource && (
                  <p className="mt-1 text-sm font-medium text-text-2">
                    {isSession ? "Con" : "Bloquea a"} {b.resource.name}
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <Badge
                variant={
                  b.status === "realizada"
                    ? "success"
                    : b.status === "no_show"
                      ? "warning"
                      : b.status === "cancelada"
                        ? "secondary"
                        : "default"
                }
              >
                {statusLabel(b)}
              </Badge>
              {isSession && (
                <Badge variant="secondary" className="gap-1">
                  {b.source === "ai" && <Sparkles className="h-3 w-3" />}
                  {b.source === "ai" ? "Agendó la IA" : "Manual"}
                </Badge>
              )}
              {b.isTest && <Badge variant="secondary">Prueba del Laboratorio</Badge>}
              {canRetrySync(b) && <Badge variant="warning">Sin enlace</Badge>}
            </div>

            {active && endMs < nowMs && isSession && (
              <p className="rounded-sm bg-warning-tint px-3 py-2 text-xs text-warning-text">
                La hora ya pasó: márcala como realizada o como que no asistió.
              </p>
            )}
          </section>

          {/* Con quién y dónde (la nota de un bloqueo ya es su título) */}
          {((b.contact && b.conversationId) || b.meetingLink || (b.notes && isSession)) && (
            <section className="space-y-2 border-b p-4">
              {b.contact && b.conversationId && (
                <Link
                  href={`/inbox?contact=${b.contact.id}`}
                  className="flex w-full items-center justify-center gap-2 rounded-md border bg-secondary px-3 py-2 text-sm font-medium hover:bg-accent"
                >
                  <MessageSquareText className="h-4 w-4" /> Abrir conversación
                </Link>
              )}
              {b.meetingLink && (
                <a
                  href={b.meetingLink}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex items-center gap-2 break-all text-sm text-brand-text hover:underline"
                >
                  <Video className="h-4 w-4 shrink-0" /> Enlace de la reunión
                </a>
              )}
              {b.connector === "google" && (
                <p className="text-xs text-text-3">
                  Mueve y cancela desde IntoSales: los cambios hechos en Google Calendar no se importan.
                </p>
              )}
              {b.notes && isSession && (
                <div>
                  <p className="kicker mb-1">Notas</p>
                  <p className="whitespace-pre-wrap text-sm text-text-2">{b.notes}</p>
                </div>
              )}
            </section>
          )}

          {/* El proveedor falló al crear la reunión. La cita existe; lo único
              que falta es el enlace, y se reintenta desde aquí — sin esto, un
              hipo del proveedor sería una pérdida silenciosa. */}
          {canRetrySync(b) && (
            <section className="border-b p-4">
              <div className="space-y-2 rounded-sm bg-subtle p-3">
                <p className="text-sm text-text-2">
                  Esta cita quedó sin enlace: el proveedor no respondió.
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void run({ action: "retry_link" })}
                >
                  Reintentar enlace
                </Button>
              </div>
            </section>
          )}

          {rescheduling && (
            <Reschedule
              today={today}
              busy={busy}
              resources={isSession ? resources : []}
              currentResourceId={b.resource?.id ?? null}
              onCancel={() => setRescheduling(false)}
              onPick={async (startUtc, resourceId) => {
                if (await run({ action: "reschedule", startUtc, resourceId })) {
                  setRescheduling(false);
                  onRescheduled(startUtc);
                }
              }}
            />
          )}

          {error && (
            <p role="alert" className="mx-4 mt-4 rounded-sm bg-danger-tint px-3 py-2 text-sm text-danger-text">
              {error}
            </p>
          )}
        </div>

        {active && (
          <footer className="flex flex-wrap gap-2 border-t p-4">
            <Button
              size="sm"
              variant={rescheduling ? "default" : "secondary"}
              disabled={busy}
              onClick={() => setRescheduling((r) => !r)}
            >
              <CalendarClock className="h-3.5 w-3.5" /> Reprogramar
            </Button>
            {/* Un bloqueo no se "realiza" ni tiene quien falte: solo se mueve
                o se quita. */}
            {isSession && (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void run({ action: "status", status: "realizada" })}
                >
                  Realizada
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void run({ action: "status", status: "no_show" })}
                >
                  No asistió
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              className="text-danger-text"
              onClick={() => void run({ action: "cancel" })}
            >
              {isSession ? "Cancelar cita" : "Quitar bloqueo"}
            </Button>
          </footer>
        )}
      </aside>
    </>
  );
}

/**
 * Los huecos libres de TODA la ventana del negocio, por día. Antes eran los 12
 * primeros —con citas de 30 min, «hoy por la tarde o mañana temprano»—.
 * Se piden al abrir, no en cada refresco: antes cada evento SSE (cada cita que
 * agendaba la IA) recalculaba la disponibilidad de toda la ventana aunque
 * nadie estuviera reprogramando.
 */
function Reschedule({
  today,
  busy,
  resources,
  currentResourceId,
  onCancel,
  onPick,
}: {
  today: string;
  busy: boolean;
  resources: ResourceOption[];
  currentResourceId: string | null;
  onCancel: () => void;
  onPick: (startUtc: string, resourceId: string | null) => void;
}) {
  // 1029 — Conserva a la persona; cambiarla muestra los huecos de la nueva.
  const [resourceId, setResourceId] = useState(currentResourceId);

  return (
    <section className="space-y-3 border-b p-4" aria-label="Mover a">
      <div className="flex items-center justify-between">
        <p className="kicker">Mover a</p>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs font-medium text-text-3 hover:text-foreground"
        >
          Cancelar
        </button>
      </div>
      {resources.length >= 2 && (
        <select
          aria-label="Con quién atiende"
          value={resourceId ?? ""}
          onChange={(e) => setResourceId(e.target.value || null)}
          className={SELECT_CLASS}
        >
          {!currentResourceId && <option value="">Sin profesional</option>}
          {resources.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      )}
      <SlotPicker
        key={resourceId ?? "todos"}
        today={today}
        busy={busy}
        resourceId={resourceId}
        emptyMessage="No hay huecos libres para mover esta cita."
        onPick={(slot) => onPick(slot.startUtc, resourceId)}
      />
    </section>
  );
}
