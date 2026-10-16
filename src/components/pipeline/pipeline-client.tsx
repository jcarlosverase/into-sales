"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { MessageSquareText, Settings2, Trophy, XCircle } from "lucide-react";
import type { LossReason, PriorityValue, StageDto } from "@/lib/types";
import { formatMoneyCents, summable } from "@/lib/money";
import { cn, initials } from "@/lib/utils";
import { ContactAvatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { formatTime } from "@/components/inbox/helpers";
import { StageManager } from "./stage-manager";
import { LossReasonDialog } from "./loss-reason-dialog";
import { AmountDialog } from "./amount-dialog";
import { PriorityBadge } from "./priority-picker";
import { LeadDrawer } from "./lead-drawer";

export type BoardLead = {
  id: string;
  stageId: string;
  position: number;
  lastActivityAt: string | null;
  contact: { id: string; name: string; phone: string | null };
  conversationId: string | null;
  amountCents: number | null;
  currency: string | null;
  priority: PriorityValue | null;
  /** 029 — next follow-up day (`AAAA-MM-DD`) and its note. */
  followUpOn: string | null;
  followUpNote: string | null;
  /** 022 — the sales rep who owns the lead, or null when unassigned. */
  assignee: TeamMember | null;
};

/** 022 — someone a lead can be assigned to. */
export type TeamMember = { id: string; name: string };

export function PipelineClient() {
  const [stages, setStages] = useState<StageDto[]>([]);
  const [currency, setCurrency] = useState("MXN");
  const [leads, setLeads] = useState<BoardLead[]>([]);
  // 022 — only supervisors can reassign; `team` is who they can pick.
  const [canAssign, setCanAssign] = useState(false);
  const [team, setTeam] = useState<TeamMember[]>([]);
  // 029 — hoy del negocio, para los atajos de «Próximo contacto».
  const [today, setToday] = useState<string | null>(null);
  const [activeLead, setActiveLead] = useState<BoardLead | null>(null);
  const [managing, setManaging] = useState(false);
  /** Arrastre hacia una etapa perdida, esperando el motivo. */
  const [pendingLoss, setPendingLoss] = useState<{
    leadId: string;
    stageId: string;
    name: string;
  } | null>(null);
  /** Tarjeta cuyo monto se está capturando. */
  const [editingAmount, setEditingAmount] = useState<BoardLead | null>(null);
  /**
   * Trato abierto en el cajón. Se guarda el ID y no el objeto: así el cajón
   * lee siempre del tablero y refleja al instante lo que se cambie desde
   * dentro, en vez de enseñar una copia que envejece.
   */
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = leads.find((l) => l.id === openId) ?? null;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const refetch = useCallback(async () => {
    const res = await fetch("/api/pipeline/board").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as {
      stages: StageDto[];
      leads: BoardLead[];
      currency?: string;
      today?: string;
      canAssign?: boolean;
      team?: TeamMember[];
    };
    if (data.currency) setCurrency(data.currency);
    setCanAssign(data.canAssign ?? false);
    setTeam(data.team ?? []);
    setToday(data.today ?? null);
    setStages(data.stages);
    setLeads(data.leads);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // 029 — `/pipeline?lead=<id>` (desde «Hoy») abre ese trato en el cajón.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("lead");
    if (id) setOpenId(id);
  }, []);

  function onDragStart(event: DragStartEvent) {
    const lead = leads.find((l) => l.id === event.active.id);
    setActiveLead(lead ?? null);
  }

  async function moveLead(
    leadId: string,
    overStage: string,
    loss?: { reason: LossReason; note: string }
  ) {
    const position = leads.filter((l) => l.stageId === overStage).length;
    // Optimista + persistencia
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, stageId: overStage, position } : l))
    );
    await fetch(`/api/pipeline/leads/${leadId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        stageId: overStage,
        position,
        ...(loss
          ? { lossReason: loss.reason, ...(loss.note ? { lossNote: loss.note } : {}) }
          : {}),
      }),
    }).catch(() => null);
    void refetch();
  }

  async function saveAmount(leadId: string, cents: number | null) {
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, amountCents: cents } : l))
    );
    await fetch(`/api/pipeline/leads/${leadId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      // Sin `stageId`: esto NO mueve la tarjeta, solo escribe el importe.
      body: JSON.stringify({ amountCents: cents }),
    }).catch(() => null);
    void refetch();
  }

  async function savePriority(leadId: string, priority: PriorityValue | null) {
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, priority } : l))
    );
    await fetch(`/api/pipeline/leads/${leadId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ priority }),
    }).catch(() => null);
    void refetch();
  }

  // 029 — próximo contacto desde el cajón.
  async function saveFollowUp(leadId: string, next: { followUpOn: string | null; followUpNote: string | null }) {
    setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, ...next } : l)));
    await fetch(`/api/pipeline/leads/${leadId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    }).catch(() => null);
    void refetch();
  }

  async function saveRep(leadId: string, userId: string | null) {
    const assignee = userId ? (team.find((m) => m.id === userId) ?? null) : null;
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, assignee } : l))
    );
    await fetch(`/api/pipeline/leads/${leadId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assignedUserId: userId }),
    }).catch(() => null);
    void refetch();
  }

  async function onDragEnd(event: DragEndEvent) {
    setActiveLead(null);
    const leadId = String(event.active.id);
    const overStage = event.over ? String(event.over.id) : null;
    if (!overStage) return;
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.stageId === overStage) return;

    // Perder un trato exige motivo. Se pregunta ANTES de mover: si el dueño
    // cancela, la tarjeta ni siquiera parpadea fuera de su columna.
    const destination = stages.find((s) => s.id === overStage);
    if (destination?.kind === "lost") {
      setPendingLoss({ leadId, stageId: overStage, name: lead.contact.name });
      return;
    }

    await moveLead(leadId, overStage);
  }

  /**
   * Cambiar de etapa desde el cajón. Entra por la MISMA puerta que el
   * arrastre: perder un trato exige motivo venga de donde venga, y duplicar
   * esa regla aquí sería tener dos sitios donde olvidarla.
   */
  function moveFromDrawer(leadId: string, stageId: string) {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.stageId === stageId) return;
    const destination = stages.find((s) => s.id === stageId);
    if (destination?.kind === "lost") {
      setPendingLoss({ leadId, stageId, name: lead.contact.name });
      return;
    }
    void moveLead(leadId, stageId);
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 sm:px-6 sm:py-4">
        <h2 className="text-[17px] font-bold tracking-tight">Pipeline</h2>
        <Button variant="outline" size="sm" onClick={() => setManaging(true)}>
          <Settings2 className="h-4 w-4" /> Gestionar etapas
        </Button>
      </header>

      {/* El tablero se arrastra en horizontal; en el teléfono cada columna
          se detiene en su sitio (snap) para no quedar a medio camino. */}
      <div className="flex-1 snap-x snap-mandatory overflow-x-auto p-3 sm:snap-none sm:p-4">
        <DndContext
          sensors={sensors}
          onDragStart={onDragStart}
          onDragEnd={(e) => void onDragEnd(e)}
        >
          <div className="flex h-full gap-3">
            {stages.map((stage) => (
              <StageColumn
                key={stage.id}
                stage={stage}
                currency={currency}
                onEditAmount={setEditingAmount}
                onOpen={(l) => setOpenId(l.id)}
                leads={leads
                  .filter((l) => l.stageId === stage.id)
                  .sort((a, b) => a.position - b.position)}
              />
            ))}
          </div>
          <DragOverlay>
            {activeLead ? (
              <LeadCard lead={activeLead} currency={currency} overlay />
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      {managing && (
        <StageManager
          stages={stages}
          onClose={() => setManaging(false)}
          onChanged={() => void refetch()}
        />
      )}

      {/* Va ANTES que los diálogos: con el mismo z-index, el que se pinta
          después queda encima, y el motivo de pérdida debe tapar al cajón. */}
      {opened && (
        <LeadDrawer
          lead={opened}
          stages={stages}
          currency={currency}
          onClose={() => setOpenId(null)}
          onMoveStage={(stageId) => moveFromDrawer(opened.id, stageId)}
          onAmount={(cents) => void saveAmount(opened.id, cents)}
          onPriority={(p) => void savePriority(opened.id, p)}
          today={today}
          onFollowUp={(next) => void saveFollowUp(opened.id, next)}
          canAssign={canAssign}
          team={team}
          onAssign={(userId) => void saveRep(opened.id, userId)}
        />
      )}

      {editingAmount && (
        <AmountDialog
          leadName={editingAmount.contact.name}
          currency={editingAmount.currency ?? currency}
          amountCents={editingAmount.amountCents}
          priority={editingAmount.priority}
          onPriorityChange={(p) => {
            setEditingAmount({ ...editingAmount, priority: p });
            void savePriority(editingAmount.id, p);
          }}
          onCancel={() => setEditingAmount(null)}
          onSave={(cents) => {
            const leadId = editingAmount.id;
            setEditingAmount(null);
            void saveAmount(leadId, cents);
          }}
        />
      )}

      {pendingLoss && (
        <LossReasonDialog
          leadName={pendingLoss.name}
          onCancel={() => setPendingLoss(null)}
          onConfirm={(reason, note) => {
            const { leadId, stageId } = pendingLoss;
            setPendingLoss(null);
            void moveLead(leadId, stageId, { reason, note });
          }}
        />
      )}
    </div>
  );
}

/**
 * Totales de una columna. Se calculan al pintar: un total guardado se
 * desincroniza en cuanto alguien mueve una tarjeta, y sumar unas decenas es
 * gratis. Todo en CENTAVOS enteros — el dinero jamás pasa por coma flotante.
 */
function stageTotals(leads: BoardLead[], businessCurrency: string) {
  let totalCents = 0;
  let withoutAmount = 0;
  let otherCurrency = 0;

  for (const l of leads) {
    if (l.amountCents === null) {
      withoutAmount++;
      continue;
    }
    if (!summable({ amountCents: l.amountCents, currency: l.currency }, businessCurrency)) {
      otherCurrency++;
      continue;
    }
    totalCents += l.amountCents;
  }
  return { totalCents, withoutAmount: withoutAmount, otherCurrency: otherCurrency };
}

function StageColumn({
  stage,
  leads,
  currency,
  onEditAmount,
  onOpen,
}: {
  stage: StageDto;
  leads: BoardLead[];
  currency: string;
  onEditAmount: (lead: BoardLead) => void;
  onOpen: (lead: BoardLead) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex h-full w-64 shrink-0 snap-start flex-col rounded-lg border border-border-strong bg-subtle transition-[box-shadow,border-color]",
        isOver && "border-brand ring-[3px] ring-brand-soft"
      )}
    >
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="flex items-center gap-1.5 text-[13.5px] font-bold tracking-tight">
          {stage.kind === "won" && <Trophy className="h-3.5 w-3.5 text-primary" />}
          {stage.kind === "lost" && (
            <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          {stage.name}
        </span>
        <span className="rounded-full border border-border-strong bg-background px-2 py-0.5 font-mono text-[11px] text-text-3">
          {leads.length}
        </span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {leads.map((lead) => (
          <DraggableLead
            key={lead.id}
            lead={lead}
            currency={currency}
            onEditAmount={onEditAmount}
            onOpen={onOpen}
          />
        ))}
      </div>
      <StageFooter leads={leads} currency={currency} />
    </div>
  );
}

/** Cuánto dinero hay en esta etapa, y qué quedó fuera de la cuenta. */
function StageFooter({ leads, currency }: { leads: BoardLead[]; currency: string }) {
  const { totalCents, withoutAmount: withoutAmount, otherCurrency: otherCurrency } = stageTotals(leads, currency);
  const withAmount = leads.length - withoutAmount - otherCurrency;

  return (
    <div className="border-t px-3 py-2 text-[11px]">
      {withAmount === 0 ? (
        // Un "$0.00" aquí se lee como un error del sistema, no como un dato.
        <p className="text-muted-foreground">Sin montos capturados</p>
      ) : (
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-muted-foreground">
            Total{withoutAmount > 0 ? ` · ${withoutAmount} sin monto` : ""}
          </span>
          <span className="font-semibold tabular-nums">
            {formatMoneyCents(totalCents, currency)}
          </span>
        </div>
      )}
      {otherCurrency > 0 && (
        // Descartarlos en silencio haría que el total mintiera sin que nadie
        // pudiera notarlo.
        <p className="mt-0.5 text-warning-text">
          {otherCurrency} en otra moneda, fuera del total
        </p>
      )}
    </div>
  );
}

function DraggableLead({
  lead,
  currency,
  onEditAmount,
  onOpen,
}: {
  lead: BoardLead;
  currency: string;
  onEditAmount: (lead: BoardLead) => void;
  onOpen: (lead: BoardLead) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: lead.id,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      // Abrir y arrastrar conviven porque el sensor solo activa el arrastre a
      // los 6 px de movimiento: un clic quieto nunca llega a ser un arrastre.
      // Los controles de dentro de la tarjeta cortan la propagación, para que
      // tocar "+ monto" no abra además el cajón.
      onClick={() => onOpen(lead)}
      // dnd-kit ya deja el nodo con `role="button"` y `tabIndex`, pero un div
      // no dispara `click` con el teclado: sin esto, el cajón sería alcanzable
      // solo con el ratón.
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(lead);
        }
      }}
      aria-label={`Abrir el trato de ${lead.contact.name}`}
      className={cn(isDragging && "opacity-40")}
    >
      <LeadCard lead={lead} currency={currency} onEditAmount={onEditAmount} />
    </div>
  );
}

function LeadCard({
  lead,
  currency,
  overlay = false,
  onEditAmount,
}: {
  lead: BoardLead;
  currency: string;
  overlay?: boolean;
  onEditAmount?: (lead: BoardLead) => void;
}) {
  return (
    <div
      className={cn(
        "cursor-grab rounded-md border border-border-strong bg-card p-3 shadow-sm transition-shadow hover:shadow-md",
        overlay && "rotate-2 shadow-pop"
      )}
    >
      <div className="flex items-center gap-2.5">
        <ContactAvatar name={lead.contact.name} seed={lead.contact.id} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-semibold">{lead.contact.name}</p>
            {lead.priority && <PriorityBadge value={lead.priority} />}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {lead.lastActivityAt
              ? `Actividad: ${formatTime(lead.lastActivityAt)}`
              : "Sin actividad"}
          </p>
        </div>
        <AssigneeChip assignee={lead.assignee} />
        {lead.conversationId && (
          <Link
            href={`/inbox?contact=${lead.contact.id}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            aria-label="Abrir conversación"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <MessageSquareText className="h-4 w-4" />
          </Link>
        )}
      </div>
      {!overlay && onEditAmount && (
        <button
          // `stopPropagation` en pointerdown: sin esto, tocar el monto empieza
          // un arrastre y el diálogo nunca abre.
          onPointerDown={(e) => e.stopPropagation()}
          // También en `click`: sin esto, tocar el monto abriría además el
          // cajón, porque el evento sigue subiendo hasta la tarjeta.
          onClick={(e) => {
            e.stopPropagation();
            onEditAmount(lead);
          }}
          className={cn(
            "mt-1.5 w-full rounded px-1 py-0.5 text-right text-xs tabular-nums hover:bg-accent",
            lead.amountCents === null
              ? "text-text-3"
              : "font-semibold text-foreground"
          )}
        >
          {lead.amountCents === null
            ? "+ monto"
            : formatMoneyCents(lead.amountCents, lead.currency ?? currency)}
        </button>
      )}
      {overlay && lead.amountCents !== null && (
        <p className="mt-1.5 text-right text-xs font-semibold tabular-nums">
          {formatMoneyCents(lead.amountCents, lead.currency ?? currency)}
        </p>
      )}
    </div>
  );
}

/** 022 — who owns the card: the rep's initials, or a muted "unassigned" mark. */
function AssigneeChip({ assignee }: { assignee: TeamMember | null }) {
  if (!assignee) {
    return (
      <span
        title="Sin asignar"
        aria-label="Sin asignar"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-dashed border-border-strong text-[10px] text-text-3"
      >
        ?
      </span>
    );
  }
  return (
    <span
      title={`Asignado a ${assignee.name}`}
      aria-label={`Asignado a ${assignee.name}`}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[10px] font-bold text-brand-text"
    >
      {initials(assignee.name)}
    </span>
  );
}
