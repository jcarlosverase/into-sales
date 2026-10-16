"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Check, MessageCircle, Phone } from "lucide-react";
import { PriorityBadge } from "@/components/pipeline/priority-picker";
import { Button } from "@/components/ui/button";
import { followUpChoices, overdueLabel, type TodaySectionId } from "@/lib/today";
import { cn } from "@/lib/utils";
import type { PriorityValue } from "@/lib/types";

/**
 * 029 — «Hoy»: a quién llamar, en tres secciones (vencidos, para hoy y sin
 * primer contacto). «Hecho» reprograma y saca al lead de la lista.
 */

type Item = {
  leadId: string;
  contactId: string;
  name: string;
  phone: string | null;
  conversationId: string | null;
  priority: PriorityValue | null;
  followUpOn: string | null;
  followUpNote: string | null;
  stageName: string;
  assignee: { id: string; name: string } | null;
};
type Section = { id: TodaySectionId; label: string; total: number; items: Item[] };
type Data = {
  today: string;
  sections: Section[];
  canFilter: boolean;
  team: { id: string; name: string }[];
};

const EMPTY: Record<TodaySectionId, string> = {
  overdue: "Nada atrasado.",
  today: "Nada agendado para hoy.",
  first_contact: "Todos los leads nuevos ya tienen respuesta.",
};

const date = (iso: string) =>
  new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

export function TodayClient() {
  const [data, setData] = useState<Data | null>(null);
  const [who, setWho] = useState("todos");
  const [doneOpen, setDoneOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/today?vendedor=${encodeURIComponent(who)}`).catch(() => null);
    if (res?.ok) setData((await res.json()) as Data);
  }, [who]);

  useEffect(() => {
    void load();
  }, [load]);

  async function done(item: Item, followUpOn: string | null) {
    setDoneOpen(null);
    // Optimista: sale de la lista ya; el servidor confirma con la recarga.
    setData((d) =>
      d
        ? {
            ...d,
            sections: d.sections.map((s) => ({
              ...s,
              total: s.items.some((i) => i.leadId === item.leadId) ? s.total - 1 : s.total,
              items: s.items.filter((i) => i.leadId !== item.leadId),
            })),
          }
        : d
    );
    await fetch(`/api/pipeline/leads/${item.leadId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ followUpOn, ...(followUpOn ? {} : { followUpNote: null }) }),
    }).catch(() => null);
    void load();
  }

  const total = data?.sections.reduce((n, s) => n + s.total, 0) ?? 0;

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:gap-4 sm:px-6 sm:py-4">
        <div className="min-w-0">
          <h2 className="text-[17px] font-bold tracking-tight">Hoy</h2>
          <p className="text-xs capitalize text-text-3" data-testid="today-date">
            {data ? date(data.today) : "…"}
          </p>
        </div>
        {data?.canFilter ? (
          <select
            value={who}
            onChange={(e) => setWho(e.target.value)}
            aria-label="Ver la lista de"
            className="h-9 max-w-full rounded-md border border-input bg-card px-2 text-sm"
          >
            <option value="todos">Todos</option>
            <option value="sin_asignar">Sin asignar</option>
            {data.team.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
        {data === null ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : total === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-text-3">
            Nada pendiente por hoy. Fija el próximo contacto en el cajón de cada trato y aparecerá aquí ese día.
          </p>
        ) : (
          data.sections.map((section) => (
            <section key={section.id} data-testid="today-section" data-section={section.id}>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-text-2">
                {section.label}
                <span className="rounded-full bg-secondary px-2 text-xs font-medium" data-testid="today-count">
                  {section.total}
                </span>
              </h3>
              {section.items.length === 0 ? (
                <p className="text-sm text-text-3">{EMPTY[section.id]}</p>
              ) : (
                <ul className="divide-y rounded-lg border bg-card">
                  {section.items.map((item) => (
                    <li key={item.leadId} data-testid="today-row" className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:px-4">
                      <div className="min-w-0 flex-1 basis-56">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={`/pipeline?lead=${item.leadId}`} className="truncate text-sm font-semibold hover:text-brand-ink">
                            {item.name}
                          </Link>
                          {item.priority ? <PriorityBadge value={item.priority} /> : null}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-text-3">
                          {item.stageName}
                          {section.id === "overdue" && item.followUpOn ? ` · ${overdueLabel(item.followUpOn, data.today)}` : ""}
                          {data.canFilter ? ` · ${item.assignee?.name ?? "Sin asignar"}` : ""}
                          {item.followUpNote ? ` · ${item.followUpNote}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                        {item.phone ? (
                          <a href={`tel:+${item.phone.replace(/^\+/, "")}`} className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs hover:bg-accent">
                            <Phone className="h-3.5 w-3.5" aria-hidden />
                            Llamar
                          </a>
                        ) : null}
                        {item.conversationId ? (
                          <Link href={`/inbox?contact=${item.contactId}`} className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs hover:bg-accent">
                            <MessageCircle className="h-3.5 w-3.5" aria-hidden />
                            Conversación
                          </Link>
                        ) : null}
                        <div className="relative">
                          <Button size="sm" variant="outline" className="h-8 gap-1 px-2 text-xs" aria-expanded={doneOpen === item.leadId} onClick={() => setDoneOpen(doneOpen === item.leadId ? null : item.leadId)}>
                            <Check className="h-3.5 w-3.5" aria-hidden />
                            Hecho
                          </Button>
                          {doneOpen === item.leadId ? (
                            <div role="menu" aria-label="¿Cuándo vuelves a llamar?" className="absolute right-0 z-20 mt-1 w-44 rounded-md border bg-popover p-1 shadow-md">
                              <p className="px-2 py-1 text-[11px] text-text-3">¿Cuándo vuelves a llamar?</p>
                              {followUpChoices(data.today).map((c) => (
                                <button
                                  key={c.label}
                                  type="button"
                                  role="menuitem"
                                  onClick={() => void done(item, c.value)}
                                  className={cn("block w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent")}
                                >
                                  {c.label}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))
        )}
      </div>
    </div>
  );
}
