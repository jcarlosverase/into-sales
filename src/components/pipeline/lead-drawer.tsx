"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { MessageSquareText, X } from "lucide-react";
import type {
  AdDto,
  QualificationDto,
  QualificationValue,
  PriorityValue,
  StageDto,
} from "@/lib/types";
import { formatMoneyCents, parseMoneyToCents } from "@/lib/money";
import { cn, formatPhone } from "@/lib/utils";
import { AdOrigin } from "@/components/ad-origin";
import { ContactAvatar } from "@/components/avatar";
import { QualificationPanel } from "@/components/qualification-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PriorityPicker } from "./priority-picker";
import { FollowUpPicker } from "./follow-up-picker";
import type { BoardLead, TeamMember } from "./pipeline-client";

/**
 * El trato, abierto, sin salir del tablero.
 *
 * Antes el clic en una tarjeta no hacía nada: para ver de quién era había que
 * irse a la bandeja y volver, y revisando una columna de quince eso son treinta
 * viajes. El cajón contesta la pregunta "¿quién es y cómo va?" en el sitio
 * donde uno la hace.
 */
export function LeadDrawer({
  lead,
  stages,
  currency,
  onClose,
  onMoveStage,
  onAmount,
  onPriority,
  today = null,
  onFollowUp,
  canAssign,
  team,
  onAssign,
}: {
  lead: BoardLead;
  stages: StageDto[];
  /** Moneda del negocio, para el lead que aún no tiene la suya. */
  currency: string;
  onClose: () => void;
  /** Pasa por el mismo camino que el arrastre: perder exige motivo. */
  onMoveStage: (stageId: string) => void;
  onAmount: (cents: number | null) => void;
  onPriority: (value: PriorityValue | null) => void;
  /** 029 — next follow-up; `today` is the business day (from the server). */
  today?: string | null;
  onFollowUp?: (next: { followUpOn: string | null; followUpNote: string | null }) => void;
  /** 022 — supervisors pick the owner; a sales rep only sees it. */
  canAssign: boolean;
  team: TeamMember[];
  onAssign: (userId: string | null) => void;
}) {
  const [qualification, setQualification] = useState<QualificationDto>({});
  // 018: de qué anuncio llegó; null si escribió por su cuenta.
  const [ad, setAd] = useState<AdDto | null>(null);
  const [amount, setAmount] = useState("");
  const [editingAmount, setEditingAmount] = useState(false);

  const contactId = lead.contact.id;
  const currencyValue = lead.currency ?? currency;

  const loadQualification = useCallback(async () => {
    const detail = await fetch(`/api/contacts/${contactId}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    setQualification(detail?.contact?.ficha ?? {});
    setAd(detail?.ad ?? null);
  }, [contactId]);

  // Al abrir otro trato no puede asomarse el anuncio del anterior.
  useEffect(() => setAd(null), [contactId]);

  useEffect(() => {
    setEditingAmount(false);
    setAmount(lead.amountCents === null ? "" : (lead.amountCents / 100).toFixed(2));
    void loadQualification();
  }, [loadQualification, lead.amountCents]);

  // Escape cierra: un cajón que solo se cierra con el ratón estorba a quien
  // revisa el tablero con el teclado.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function saveQualification(patch: Record<string, QualificationValue | null>) {
    setQualification((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) delete next[k];
        else next[k] = v;
      }
      return next;
    });
    await fetch(`/api/contacts/${contactId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ficha: patch }),
    }).catch(() => null);
    void loadQualification();
  }

  const amountParsed = amount.trim() ? parseMoneyToCents(amount) : null;
  const invalidAmount = amount.trim().length > 0 && amountParsed === null;

  return (
    <>
      {/* Velo: cerrar tocando fuera es lo que uno intenta primero. */}
      <button
        aria-label="Cerrar el trato"
        tabIndex={-1}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-overlay"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Trato de ${lead.contact.name}`}
        className="fixed inset-y-0 right-0 z-50 flex w-[min(360px,92vw)] flex-col border-l bg-popover shadow-pop"
      >
        <header className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="kicker text-text-2">
            Trato
          </h3>
          <button
            onClick={onClose}
            aria-label="Cerrar el panel del trato"
            className="rounded p-1 text-text-3 hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" strokeWidth={1.7} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {/* Quién */}
          <section className="border-b p-4">
            <div className="flex items-center gap-3">
              <ContactAvatar
                name={lead.contact.name}
                seed={lead.contact.id}
                size="md"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-[650]">{lead.contact.name}</p>
                <p className="text-xs text-text-3">
                  {formatPhone(lead.contact.phone)}
                </p>
              </div>
            </div>

            {lead.conversationId ? (
              <Link
                href={`/inbox?contact=${lead.contact.id}`}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-md border bg-secondary px-3 py-2 text-sm font-medium hover:bg-accent"
              >
                <MessageSquareText className="h-4 w-4" /> Abrir conversación
              </Link>
            ) : (
              <p className="mt-3 text-xs text-text-3">
                Todavía no hay conversación con este contacto.
              </p>
            )}

            {ad && (
              <div className="mt-3">
                <AdOrigin ad={ad} />
              </div>
            )}
          </section>

          {/* Cuánto */}
          <section className="border-b p-4">
            <p className="mb-2 kicker">
              Monto ({currencyValue})
            </p>
            {editingAmount ? (
              <>
                <Input
                  autoFocus
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !invalidAmount) {
                      setEditingAmount(false);
                      onAmount(amountParsed);
                    }
                    if (e.key === "Escape") setEditingAmount(false);
                  }}
                  placeholder="12,500"
                  aria-label="Monto del trato"
                  className="h-8 text-sm"
                />
                <p className="mt-1 text-xs text-text-3">
                  {invalidAmount
                    ? "No se entiende ese importe."
                    : amountParsed === null
                      ? "Déjalo vacío para quitar el monto."
                      : `Se guardará como ${formatMoneyCents(amountParsed, currencyValue)}`}
                </p>
                <div className="mt-2 flex gap-1.5">
                  <Button
                    size="sm"
                    disabled={invalidAmount}
                    onClick={() => {
                      setEditingAmount(false);
                      onAmount(amountParsed);
                    }}
                  >
                    Guardar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditingAmount(false)}
                  >
                    Cancelar
                  </Button>
                </div>
              </>
            ) : (
              <button
                onClick={() => setEditingAmount(true)}
                aria-label="Editar el monto"
                className={cn(
                  "w-full rounded px-1 py-1 text-left text-sm tabular-nums hover:bg-accent",
                  lead.amountCents === null
                    ? "text-text-3"
                    : "font-semibold text-foreground"
                )}
              >
                {lead.amountCents === null
                  ? "Sin monto — captúralo"
                  : formatMoneyCents(lead.amountCents, currencyValue)}
              </button>
            )}
          </section>

          {/* 022 — Quién lo atiende */}
          <section className="border-b p-4">
            <p className="mb-2 kicker">Vendedor</p>
            {canAssign ? (
              <select
                value={lead.assignee?.id ?? ""}
                onChange={(e) => onAssign(e.target.value || null)}
                aria-label="Vendedor asignado"
                className="h-8 w-full rounded-md border border-border-strong bg-background px-2 text-sm"
              >
                <option value="">Sin asignar</option>
                {team.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-sm">{lead.assignee?.name ?? "Sin asignar"}</p>
            )}
          </section>

          {/* A quién llamar primero */}
          <section className="border-b p-4">
            <p className="mb-2 kicker">
              Prioridad
            </p>
            <PriorityPicker value={lead.priority} onChange={onPriority} />
          </section>

          {/* 029 — Cuándo volver a llamar */}
          {onFollowUp ? (
            <section className="border-b p-4">
              <p className="mb-2 kicker">Próximo contacto</p>
              <FollowUpPicker value={lead.followUpOn} note={lead.followUpNote} today={today} onChange={onFollowUp} />
            </section>
          ) : null}

          {/* Dónde va */}
          <section className="border-b p-4">
            <p className="mb-2 kicker">
              Etapa
            </p>
            <div className="flex flex-wrap gap-1.5">
              {stages.map((s) => {
                const actual = s.id === lead.stageId;
                return (
                  <button
                    key={s.id}
                    onClick={() => !actual && onMoveStage(s.id)}
                    aria-pressed={actual}
                    aria-label={`Mover a ${s.name}`}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs transition-colors",
                      actual
                        ? "border-brand bg-brand-tint font-semibold text-brand-text"
                        : "border-border text-text-2 hover:bg-accent"
                    )}
                  >
                    {s.name}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Qué se sabe */}
          <QualificationPanel ficha={qualification} onSave={saveQualification} />
        </div>
      </aside>
    </>
  );
}
