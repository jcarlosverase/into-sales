import { redirect } from "next/navigation";
import { AlertTriangle, Check, Minus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { featureLines } from "@/lib/about";
import { getSessionOrNull } from "@/lib/auth/session";
import { LICENSE_NAME, LICENSE_TEXT } from "@/lib/license";
import { APP_VERSION, resolveCommit } from "@/lib/version";
import { getBranding } from "@/server/branding";
import { centralEnabled } from "@/server/central/flag";
import { getPublicLicense } from "@/server/central/license";
import { healthFeatures } from "@/server/health";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Acerca de" };

/** 1000 — Versión, módulos encendidos, plan del central, licencia y créditos. */
export default async function AboutPage() {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  const branding = await getBranding(session.organizationId);
  const { commit, verified } = resolveCommit();
  const features = healthFeatures();
  // AC4 — Solo con el central encendido; la llave nunca sale (a lo más sus últimos 4).
  const license = features.central && centralEnabled() ? await getPublicLicense(session.organizationId) : null;

  return (
    <div className="h-full overflow-y-auto">
      <header className="border-b px-4 py-3 sm:px-6 sm:py-4">
        <h2 className="text-[17px] font-bold tracking-tight">Acerca de</h2>
      </header>
      <div className="mx-auto grid max-w-3xl gap-4 p-4 sm:gap-6 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>{branding.name}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm" data-testid="about-version">
              <dt className="text-text-3">Versión</dt>
              <dd className="font-mono">{APP_VERSION}</dd>
              <dt className="text-text-3">Commit</dt>
              <dd className="min-w-0 break-all font-mono">
                {commit || "—"}
                {commit && !verified ? (
                  <span className="mt-0.5 flex items-center gap-1 font-sans text-xs text-text-2">
                    <AlertTriangle className="h-3 w-3 shrink-0 text-warning-text" aria-hidden />
                    No verificado: lo dice la plataforma, no el build
                  </span>
                ) : null}
              </dd>
              {license ? (
                <>
                  <dt className="text-text-3">Plan</dt>
                  <dd data-testid="about-plan">
                    {license.plan ? `${license.plan.name} (${license.plan.code})` : "Sin confirmar"}
                    {license.account ? ` · ${license.account === "active" ? "Activa" : "Suspendida"}` : ""}
                  </dd>
                </>
              ) : null}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Módulos de esta instancia</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm" data-testid="about-features">
              {featureLines(features).map((f) => (
                <li key={f.label} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="flex items-center gap-2">
                    {f.on ? <Check className="h-4 w-4 text-success-text" aria-hidden /> : <Minus className="h-4 w-4 text-text-3" aria-hidden />}
                    {f.label}
                  </span>
                  <span className={cn("text-xs", f.on ? "text-text-2" : "text-text-3")}>{f.detail}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Licencia y créditos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              IntoSales es un producto de into. Su código base es{" "}
              <a href="https://github.com/kevinrivm/vocero-crm" target="_blank" rel="noopener noreferrer" className="text-brand-text underline underline-offset-2">
                Vocero CRM
              </a>
              , creado por Kevin Belier, de código abierto bajo la licencia {LICENSE_NAME}.
            </p>
            <details className="rounded-md border" data-testid="about-license">
              <summary className="cursor-pointer px-3 py-2 font-medium">Ver la licencia {LICENSE_NAME}</summary>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words border-t px-3 py-2 font-mono text-xs text-text-2">{LICENSE_TEXT}</pre>
            </details>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
