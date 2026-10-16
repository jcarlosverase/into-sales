"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

type RoutingMember = {
  userId: string;
  name: string;
  email: string;
  receivesLeads: boolean;
};

type RoutingSettings = {
  enabled: boolean;
  canEdit: boolean;
  members: RoutingMember[];
};

/**
 * 022 — Lead routing: each new lead goes to the next sales rep in line.
 * Supervisors turn it on/off and pick who receives new leads; a sales rep
 * sees the same card read-only.
 */
export function LeadRoutingCard({ refreshKey }: { refreshKey: number }) {
  const [settings, setSettings] = useState<RoutingSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/settings/lead-routing").catch(() => null);
    if (!res?.ok) return;
    setSettings((await res.json()) as RoutingSettings);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch, refreshKey]);

  async function save(patch: { enabled?: boolean; userId?: string; receivesLeads?: boolean }) {
    setError(null);
    const res = await fetch("/api/settings/lead-routing", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => null);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo guardar el reparto");
      void refetch();
      return;
    }
    setSettings((await res.json()) as RoutingSettings);
  }

  if (!settings) return null;
  const { enabled, canEdit, members } = settings;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>Reparto de leads</CardTitle>
            <CardDescription>
              Cada lead nuevo va al siguiente vendedor por turno. Cada vendedor
              solo ve sus propios leads; el propietario ve todos.
            </CardDescription>
          </div>
          <Switch
            checked={enabled}
            disabled={!canEdit}
            onCheckedChange={(next) => {
              setSettings({ ...settings, enabled: next });
              void save({ enabled: next });
            }}
            label="Repartir leads nuevos por turno"
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {members.length === 0 ? (
          <p className="text-sm text-text-3">
            Todavía no hay vendedores. Crea una cuenta de equipo y empezará a
            recibir leads. Mientras tanto, los leads nuevos quedan sin asignar.
          </p>
        ) : (
          members.map((m) => (
            <div
              key={m.userId}
              className="flex items-center gap-3 rounded-md border px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{m.name}</p>
                <p className="truncate text-xs text-text-3">
                  {m.receivesLeads ? "Recibe leads nuevos" : "No recibe leads nuevos"}
                </p>
              </div>
              <Switch
                size="sm"
                checked={m.receivesLeads}
                disabled={!canEdit || !enabled}
                onCheckedChange={(next) => {
                  setSettings({
                    ...settings,
                    members: members.map((x) =>
                      x.userId === m.userId ? { ...x, receivesLeads: next } : x
                    ),
                  });
                  void save({ userId: m.userId, receivesLeads: next });
                }}
                label={`${m.name} recibe leads nuevos`}
              />
            </div>
          ))
        )}
        {!enabled && (
          <p className="text-xs text-text-3">
            Con el reparto apagado, los leads nuevos quedan sin asignar y el
            propietario los asigna desde el Pipeline.
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
