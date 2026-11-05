"use client";

import { useCallback, useEffect, useState } from "react";
import { LicenseStatus, Notice } from "@into/designsystem";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { FORMAT_KEY, LICENSE_RESULT, type ResultCentral } from "@/lib/central";

/**
 * 028 — Ajustes → Plan: la llave de licencia de into y el plan que devuelve
 * el servicio central. La llave se manda una vez y no vuelve: la pantalla
 * solo muestra sus últimos 4. Nada de esto afecta al resto del CRM.
 *
 * Spec 1022: la misma pantalla de IntoCredit (su spec 003): el estado es
 * `LicenseStatus` del sistema de diseño y debajo van «Guardar y comprobar»,
 * «Comprobar ahora» y «Quitar la llave».
 */

type License = {
  keyLast4: string;
  lastAttempt: string | null;
  lastResult: ResultCentral | null;
  lastOk: string | null;
  customerName: string | null;
  plan: { code: string; name: string } | null;
  account: "active" | "suspended" | null;
};

type View = { central: string | null; license: License | null };

type Message = { kind: "ok" | "error"; text: string };

// Como IntoCredit: «04/11/2026 08:00», en hora de Lima.
const date = new Intl.DateTimeFormat("es-PE", {
  timeZone: "America/Lima",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const when = (iso: string | null) => (iso ? date.format(new Date(iso)).replace(",", "") : null);

export function CentralClient() {
  const [view, setView] = useState<View | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<"save" | "check" | "remove" | null>(null);
  const [message, setMessage] = useState<Message | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/settings/central").catch(() => null);
    if (res?.ok) setView((await res.json()) as View);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function call(method: "PUT" | "POST" | "DELETE", body?: unknown): Promise<boolean> {
    const res = await fetch("/api/settings/central", {
      method,
      ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
    }).catch(() => null);
    if (!res?.ok) return false;
    setView((await res.json()) as View);
    return true;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const clean = key.trim();
    if (!FORMAT_KEY.test(clean)) {
      setMessage({ kind: "error", text: "La llave empieza con into_live_ y lleva 32 letras y números. Cópiala completa." });
      return;
    }
    setBusy("save");
    const ok = await call("PUT", { key: clean });
    setBusy(null);
    if (!ok) {
      // Un 500 suele ser la base sin migrar o el servidor caído: Salud dice cuál.
      setMessage({ kind: "error", text: "No se pudo guardar la llave por un error del servidor. Revisa Ajustes → Salud e inténtalo de nuevo." });
      return;
    }
    setKey("");
    setMessage({ kind: "ok", text: "Llave guardada." });
  }

  async function check() {
    setMessage(null);
    setBusy("check");
    const ok = await call("POST");
    setBusy(null);
    setMessage(ok ? { kind: "ok", text: "Latido enviado." } : { kind: "error", text: "No se pudo comprobar. Inténtalo de nuevo." });
  }

  async function remove() {
    setMessage(null);
    setBusy("remove");
    const ok = await call("DELETE");
    setBusy(null);
    if (ok) setMessage({ kind: "ok", text: "Llave quitada: IntoSales deja de latir al central." });
  }

  const license = view?.license ?? null;

  return (
    <div className="max-w-3xl space-y-4">
      <div className="mb-4">
        <h3 className="text-base font-semibold">Plan</h3>
        <p className="text-sm text-muted-foreground">
          La licencia de into de esta instalación y cómo salió el último latido al central.
        </p>
      </div>
      {message ? (
        <Notice tone={message.kind === "error" ? "danger" : "success"} role={message.kind === "error" ? "alert" : "status"}>
          {message.text}
        </Notice>
      ) : null}
      <section className="rounded-lg border border-border-strong bg-card shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 sm:px-5">
          <h3 className="text-[15px] font-bold tracking-tight">Plan y licencia de into</h3>
        </header>
        <div className="space-y-4 p-4 sm:p-5" data-testid="central-license">
          {view === null ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : (
            <LicenseStatus
              product="IntoSales"
              license={
                license
                  ? {
                      keyLast4: license.keyLast4,
                      customerName: license.customerName,
                      plan: license.plan,
                      account: license.account,
                      lastResult: license.lastResult ? LICENSE_RESULT[license.lastResult] : null,
                      lastAttemptAt: when(license.lastAttempt),
                      lastOkAt: when(license.lastOk),
                    }
                  : null
              }
              emptyText="Pega la llave de licencia que te dio into. IntoSales avisa al central que está funcionando cada 15 minutos; nunca le manda datos de tus clientes ni de tus conversaciones."
            />
          )}

          <form onSubmit={save} className="grid gap-3 sm:grid-cols-[1fr,auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="license-key">{license ? "Cambiar la llave" : "Llave de licencia"}</Label>
              <PasswordInput
                id="license-key"
                name="key"
                required
                autoComplete="off"
                spellCheck={false}
                placeholder="into_live_…"
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={busy !== null || key.trim() === ""}>
              {busy === "save" ? "Comprobando…" : "Guardar y comprobar"}
            </Button>
          </form>

          {license ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={check} disabled={busy !== null}>
                {busy === "check" ? "Comprobando…" : "Comprobar ahora"}
              </Button>
              <Button type="button" variant="ghost" className="text-danger-text" onClick={remove} disabled={busy !== null}>
                {busy === "remove" ? "Quitando…" : "Quitar la llave"}
              </Button>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
