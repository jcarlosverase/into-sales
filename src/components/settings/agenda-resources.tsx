"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  RESOURCE_NAME_MAX,
  type AgentResourceMode,
  type ResourceKind,
} from "@/lib/agenda-resources";
import { cn } from "@/lib/utils";
import { SELECT_CLASS } from "@/components/bookings/booking-look";
import { WeeklyHoursEditor, type WeeklyHours } from "./weekly-hours-editor";

/**
 * 1029 — Ajustes → Agenda: quién atiende y con qué horario. Sin nadie, la agenda
 * es la del negocio. No se borra: se archiva.
 */

type Resource = {
  id: string;
  kind: ResourceKind;
  name: string;
  weeklyHours: WeeklyHours;
  position: number;
  active: boolean;
};

const KIND_LABEL: Record<ResourceKind, string> = { person: "Persona", resource: "Recurso" };

const MODES: { id: AgentResourceMode; label: string; hint: string }[] = [
  {
    id: "first_free",
    label: "Asignar al primero libre",
    hint: "Ofrece los horarios de todos y asigna al azar entre quienes estén libres.",
  },
  {
    id: "ask",
    label: "Preguntar con quién",
    hint: "Primero pregunta con quién quiere atenderse el cliente.",
  },
];

async function errorOf(res: Response | null, fallback: string): Promise<string> {
  const data = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
  return data?.error?.message ?? fallback;
}

export function AgendaResources({ onChanged }: { onChanged: (activeCount: number) => void }) {
  const [resources, setResources] = useState<Resource[] | null>(null);
  const [mode, setMode] = useState<AgentResourceMode>("first_free");
  const [canManage, setCanManage] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ResourceKind>("person");
  const [editing, setEditing] = useState<Resource | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/calendar/resources?includeArchived=true").catch(() => null);
    if (!res?.ok) {
      setResources([]);
      return;
    }
    const data = (await res.json()) as {
      resources: Resource[];
      agentResourceMode: AgentResourceMode;
      canManage: boolean;
    };
    setResources(data.resources);
    setMode(data.agentResourceMode);
    setCanManage(data.canManage);
    onChanged(data.resources.filter((r) => r.active).length);
  }

  useEffect(() => {
    void load();
    // Solo al abrir: después se recarga tras cada cambio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send(url: string, method: string, body: unknown, fallback: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(await errorOf(res, fallback));
      return null;
    }
    return res;
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const res = await send("/api/calendar/resources", "POST", { name, kind }, "No se pudo agregar");
    if (!res) return;
    const data = (await res.json()) as { adoptedBookings: number };
    setName("");
    if (data.adoptedBookings > 0) {
      setNotice(
        data.adoptedBookings === 1
          ? "La cita futura del negocio pasó a su agenda."
          : `Las ${data.adoptedBookings} citas futuras del negocio pasaron a su agenda.`
      );
    }
    await load();
  }

  async function patch(id: string, body: Partial<Resource>, fallback: string) {
    const res = await send(`/api/calendar/resources/${id}`, "PATCH", body, fallback);
    if (res) await load();
    return Boolean(res);
  }

  /** Subir o bajar: se intercambia con el vecino y se escriben las dos posiciones. */
  async function move(index: number, dir: -1 | 1) {
    const active = (resources ?? []).filter((r) => r.active);
    const a = active[index];
    const b = active[index + dir];
    if (!a || !b) return;
    if (await patch(a.id, { position: index + dir }, "No se pudo ordenar")) {
      await patch(b.id, { position: index }, "No se pudo ordenar");
    }
  }

  async function saveEditing() {
    if (!editing) return;
    const ok = await patch(
      editing.id,
      { name: editing.name, kind: editing.kind, weeklyHours: editing.weeklyHours },
      "No se pudo guardar"
    );
    if (ok) setEditing(null);
  }

  async function changeMode(next: AgentResourceMode) {
    const res = await send(
      "/api/calendar/settings",
      "PUT",
      { agentResourceMode: next },
      "No se pudo guardar"
    );
    if (res) setMode(next);
  }

  if (resources === null) return null;
  const active = resources.filter((r) => r.active);
  const archived = resources.filter((r) => !r.active);

  return (
    <Card data-testid="agenda-resources">
      <CardHeader>
        <CardTitle>Profesionales y recursos</CardTitle>
        <CardDescription>
          Quién atiende, o qué sala o equipo se reserva, cada uno con su horario dentro del
          horario de atención. Si atiendes tú solo, no agregues a nadie.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {active.length > 0 && (
          <ul className="divide-y rounded-md border">
            {active.map((r, i) => (
              <li key={r.id} data-testid="resource-row" className="space-y-3 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{r.name}</span>
                  <Badge variant="secondary">{KIND_LABEL[r.kind]}</Badge>
                  {canManage && (
                    <span className="flex items-center gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-10 w-10 p-0 sm:h-8 sm:w-8"
                        aria-label={`Subir a ${r.name}`}
                        disabled={busy || i === 0}
                        onClick={() => void move(i, -1)}
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-10 w-10 p-0 sm:h-8 sm:w-8"
                        aria-label={`Bajar a ${r.name}`}
                        disabled={busy || i === active.length - 1}
                        onClick={() => void move(i, 1)}
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-10 sm:h-8"
                        onClick={() => setEditing(editing?.id === r.id ? null : r)}
                      >
                        Editar
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-10 sm:h-8"
                        disabled={busy}
                        onClick={() => void patch(r.id, { active: false }, "No se pudo archivar")}
                      >
                        Archivar
                      </Button>
                    </span>
                  )}
                </div>

                {editing?.id === r.id && (
                  <div className="space-y-3 border-t pt-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="resource-edit-name">Nombre</Label>
                        <Input
                          id="resource-edit-name"
                          value={editing.name}
                          maxLength={RESOURCE_NAME_MAX}
                          onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="resource-edit-kind">Tipo</Label>
                        <select
                          id="resource-edit-kind"
                          value={editing.kind}
                          onChange={(e) =>
                            setEditing({ ...editing, kind: e.target.value as ResourceKind })
                          }
                          className={SELECT_CLASS}
                        >
                          <option value="person">Persona</option>
                          <option value="resource">Recurso</option>
                        </select>
                      </div>
                    </div>
                    <WeeklyHoursEditor
                      value={editing.weeklyHours}
                      onChange={(weeklyHours) => setEditing({ ...editing, weeklyHours })}
                    />
                    <div className="flex gap-2">
                      <Button type="button" disabled={busy} onClick={() => void saveEditing()}>
                        Guardar horario
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                        Cancelar
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {canManage && (
          <form onSubmit={create} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor="resource-name">Nombre</Label>
              <Input
                id="resource-name"
                value={name}
                maxLength={RESOURCE_NAME_MAX}
                placeholder="Dra. Ana Torres"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5 sm:w-32">
              <Label htmlFor="resource-kind">Tipo</Label>
              <select
                id="resource-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as ResourceKind)}
                className={SELECT_CLASS}
              >
                <option value="person">Persona</option>
                <option value="resource">Recurso</option>
              </select>
            </div>
            <Button type="submit" disabled={busy || !name.trim()}>
              Agregar
            </Button>
          </form>
        )}

        {active.length >= 2 && (
          <fieldset className="space-y-2" data-testid="agent-resource-mode">
            <legend className="text-sm font-medium">Cuando agenda el agente</legend>
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                disabled={busy || !canManage}
                aria-pressed={mode === m.id}
                onClick={() => void changeMode(m.id)}
                className={cn(
                  "block w-full rounded-sm border px-3 py-2.5 text-left transition-colors",
                  mode === m.id ? "border-brand bg-brand-tint" : "border-border hover:bg-accent"
                )}
              >
                <span className={cn("block text-sm font-semibold", mode === m.id && "text-brand-text")}>
                  {m.label}
                </span>
                <span className="mt-0.5 block text-xs text-text-2">{m.hint}</span>
              </button>
            ))}
          </fieldset>
        )}

        {archived.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-text-3">Archivados</p>
            <ul className="space-y-1">
              {archived.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 text-sm text-text-2">
                  <span className="truncate">{r.name}</span>
                  {canManage && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-10 sm:h-8"
                      disabled={busy}
                      onClick={() => void patch(r.id, { active: true }, "No se pudo restaurar")}
                    >
                      Restaurar
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {notice && <p className="text-sm text-brand-text">{notice}</p>}
        {error && (
          <p role="alert" className="text-sm text-danger-text">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
