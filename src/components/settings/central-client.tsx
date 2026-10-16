"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ACCOUNT_LABEL, FORMAT_KEY, resultText, type ResultCentral } from "@/lib/central";

/**
 * 028 — Ajustes → Plan: la llave de licencia de into y el plan que devuelve
 * el servicio central. La llave se manda una vez y no vuelve: la pantalla
 * solo muestra sus últimos 4. Nada de esto afecta al resto del CRM.
 */

type License = {
  keyLast4: string;
  lastAttempt: string | null;
  lastResult: ResultCentral | null;
  lastOk: string | null;
  plan: { code: string; name: string } | null;
  account: "active" | "suspended" | null;
};

type View = { central: string | null; license: License | null };

type Message = { kind: "ok" | "error"; text: string };

const date = new Intl.DateTimeFormat("es-PE", { dateStyle: "medium", timeStyle: "short" });

export function CentralClient() {
  const [view, setView] = useState<View | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<"guardar" | "quitar" | null>(null);
  const [message, setMessage] = useState<Message | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/settings/central").catch(() => null);
    if (res?.ok) setView((await res.json()) as View);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const clean = key.trim();
    if (!FORMAT_KEY.test(clean)) {
      setMessage({ kind: "error", text: "La llave empieza con into_live_ y sigue con 32 letras y números." });
      return;
    }
    setBusy("guardar");
    const res = await fetch("/api/settings/central", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: clean }),
    }).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      setMessage({ kind: "error", text: "No se pudo guardar la llave. Inténtalo de nuevo." });
      return;
    }
    setKey("");
    setView((await res.json()) as View);
    setMessage({ kind: "ok", text: "Llave guardada." });
  }

  async function remove() {
    setMessage(null);
    setBusy("quitar");
    const res = await fetch("/api/settings/central", { method: "DELETE" }).catch(() => null);
    setBusy(null);
    if (res?.ok) {
      setView((await res.json()) as View);
      setMessage({ kind: "ok", text: "Llave quitada: el CRM dejó de latir al central." });
    }
  }

  const license = view?.license ?? null;
  const result = resultText(license?.lastResult ?? null);

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Plan</CardTitle>
          <CardDescription>
            Tu plan con into. Con la llave de licencia, este CRM le avisa a into cada 15 minutos que
            sigue en pie y si algo falla (sin datos de tus clientes), y aquí ves el plan que tienes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {view === null ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : license ? (
            <div className="space-y-3 rounded-md border p-3 text-sm" data-testid="central-estado">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold" data-testid="central-plan">
                  {license.plan ? license.plan.name : "Plan sin confirmar"}
                </span>
                {license.plan && <code className="font-mono text-xs text-muted-foreground">{license.plan.code}</code>}
                {license.account && (
                  <Badge variant={license.account === "active" ? "success" : "warning"} data-testid="central-cuenta">
                    {ACCOUNT_LABEL[license.account]}
                  </Badge>
                )}
              </div>
              <dl className="grid gap-x-4 gap-y-1 text-muted-foreground sm:grid-cols-[auto_1fr]">
                <dt>Llave</dt>
                <dd className="font-mono" data-testid="central-llave">
                  ••••{license.keyLast4}
                </dd>
                <dt>Último latido</dt>
                <dd>{license.lastAttempt ? date.format(new Date(license.lastAttempt)) : "Todavía ninguno"}</dd>
                {view.central && (
                  <>
                    <dt>Central</dt>
                    <dd className="break-all">{view.central}</dd>
                  </>
                )}
              </dl>
              {result && (
                <p
                  data-testid="central-resultado"
                  className={
                    result.tone === "ok"
                      ? "text-success-text"
                      : result.tone === "error"
                        ? "text-danger-text"
                        : "text-warning-text"
                  }
                >
                  {result.text}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Todavía no hay llave: pega la que te dio into. Sin ella, el CRM funciona igual y no le
              avisa nada al central.
            </p>
          )}

          <form onSubmit={save} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="central-llave">{license ? "Reemplazar la llave" : "Llave de licencia"}</Label>
              <Input
                id="central-llave"
                type="password"
                autoComplete="off"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={license ? `•••• ${license.keyLast4}` : "into_live_…"}
              />
              <p className="text-xs text-muted-foreground">Se guarda cifrada en tu servidor. No la compartas por chat.</p>
            </div>
            {message && (
              <p
                role={message.kind === "error" ? "alert" : "status"}
                className={message.kind === "error" ? "text-sm text-danger-text" : "text-sm text-success-text"}
              >
                {message.text}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={busy !== null || key.trim() === ""}>
                {busy === "guardar" ? "Guardando…" : "Guardar y probar"}
              </Button>
              {license && (
                <button
                  type="button"
                  onClick={remove}
                  disabled={busy !== null}
                  className="text-sm text-text-3 hover:text-foreground"
                >
                  Quitar
                </button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
