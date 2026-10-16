import { redirect } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { canConfigure } from "@/lib/auth/roles";
import { getSessionOrNull } from "@/lib/auth/session";
import { businessTimezone } from "@/server/analytics/period";
import { runSystemHealth, summarizeHealth } from "@/server/system-health";
import type { CheckStatus } from "@/server/doctor/checks";

export const dynamic = "force-dynamic";
export const metadata = { title: "Salud" };

const LEVEL: Record<CheckStatus, { text: string; variant: "success" | "warning" | "destructive" | "secondary" }> = {
  ok: { text: "Bien", variant: "success" },
  warn: { text: "Aviso", variant: "warning" },
  fail: { text: "Falla", variant: "destructive" },
  skip: { text: "Omitido", variant: "secondary" },
};

/** 1004 — Cómo están el CRM y sus servicios, comprobado al abrir la página. */
export default async function HealthSettingsPage() {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  if (!canConfigure(session.role)) {
    return <p className="text-sm text-muted-foreground">Solo el propietario o un administrador ven la salud del CRM.</p>;
  }
  const now = new Date();
  const rows = await runSystemHealth(session.organizationId);
  const summary = summarizeHealth(rows);
  const timeZone = await businessTimezone(session.organizationId).catch(() => "America/Lima");
  const checkedAt = new Intl.DateTimeFormat("es-PE", { dateStyle: "medium", timeStyle: "short", timeZone }).format(now);
  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Salud del CRM</h3>
          <p className="text-sm text-muted-foreground">La base de datos y los servicios de los que depende, comprobados ahora.</p>
        </div>
        {/* Un enlace normal: recargar la página repite todos los chequeos (AC2). */}
        <a
          href="/settings/health"
          data-testid="health-recheck"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors hover:bg-secondary"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          Verificar de nuevo
        </a>
      </div>
      <div className="flex flex-wrap items-center gap-2" data-testid="health-summary" data-level={summary.level}>
        <Badge variant={LEVEL[summary.level].variant}>{summary.text}</Badge>
        <span className="text-sm text-muted-foreground">Verificado el {checkedAt}</span>
      </div>
      <ul className="divide-y rounded-lg border bg-card">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-col gap-1 p-4 sm:flex-row sm:items-start sm:gap-4" data-testid={`health-${r.id}`} data-status={r.status}>
            <div className="flex shrink-0 items-center gap-2 sm:w-56">
              <Badge variant={LEVEL[r.status].variant}>{LEVEL[r.status].text}</Badge>
              <span className="text-sm font-medium">{r.label}</span>
            </div>
            <div className="min-w-0 space-y-1 text-sm">
              <p className="break-words text-text-2">{r.detail}</p>
              {r.fix && r.status !== "ok" ? <p className="break-words text-text-3">→ {r.fix}</p> : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
