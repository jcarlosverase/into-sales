"use client";

import { useCallback, useEffect, useState } from "react";
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
  AI_PROVIDERS,
  AI_PROVIDER_PRESETS,
  AI_STATUS_LABEL,
  presetFromBaseUrl,
  type AiProviderId,
  type AiStatus,
} from "@/lib/ai/presets";

/**
 * Ajustes → IA: con qué piensa el agente (issue #85).
 *
 * La llave se manda una vez y no vuelve: la pantalla solo muestra sus últimos
 * 4 y el estado. Si está pausada, dice POR QUÉ y qué hacer — no es lo mismo
 * «tu llave dejó de servir» que «tu cuenta se quedó sin saldo», y son dos
 * acciones distintas del dueño. «Probar conexión» y «Traer modelos» hablan
 * con el proveedor usando lo escrito, sin guardar nada.
 */

type Credential = {
  provider: AiProviderId;
  baseUrl: string;
  model: string;
  tokenLast4: string;
  status: AiStatus;
  reason: string | null;
  since: string | null;
  updatedAt: string;
};

type View = {
  credential: Credential | null;
  active: boolean;
  source: "org" | "env" | null;
  message: string | null;
  envFallback: { baseUrl: string; model: string; tokenLast4: string } | null;
};

type Model = { id: string; name: string | null };

type Message = { kind: "ok" | "error" | "info"; text: string };

type Busy = "guardar" | "probar" | "modelos" | "quitar" | null;

const STATUS_BADGE: Record<AiStatus, "success" | "warning" | "destructive"> = {
  active: "success",
  paused_no_credit: "warning",
  paused_invalid_token: "destructive",
};

export function AiClient() {
  const [view, setView] = useState<View | null>(null);
  const [provider, setProvider] = useState<AiProviderId>("openrouter");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [models, setModels] = useState<Model[] | null>(null);

  const load = useCallback(async (): Promise<View | null> => {
    const res = await fetch("/api/settings/ai").catch(() => null);
    if (!res?.ok) return null;
    const data = (await res.json()) as View;
    setView(data);
    return data;
  }, []);

  useEffect(() => {
    void (async () => {
      const data = await load();
      if (!data) return;
      // El formulario arranca con lo guardado; si no hay nada, con el respaldo
      // del entorno (para que «Guardar» lo deje escrito tal cual se usa hoy).
      const base = data.credential
        ? {
            provider: data.credential.provider,
            baseUrl: data.credential.baseUrl,
            model: data.credential.model,
          }
        : data.envFallback
          ? {
              provider: presetFromBaseUrl(data.envFallback.baseUrl),
              baseUrl: data.envFallback.baseUrl,
              model: data.envFallback.model,
            }
          : null;
      if (base) {
        setProvider(base.provider);
        setBaseUrl(base.provider === "openai_compatible" ? base.baseUrl : "");
        setModel(base.model);
      }
    })();
  }, [load]);

  const preset = AI_PROVIDER_PRESETS[provider];
  const cred = view?.credential ?? null;

  /** Lo que viaja en cada llamada: el token solo si se escribió. */
  function body(withModel: boolean) {
    return JSON.stringify({
      provider,
      ...(provider === "openai_compatible" ? { baseUrl: baseUrl.trim() } : {}),
      ...(withModel ? { model: model.trim() } : {}),
      ...(token.trim() ? { token: token.trim() } : {}),
    });
  }

  async function readError(res: Response | null, byDefault: string) {
    const data = (await res?.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    return data?.error?.message ?? byDefault;
  }

  const missingBase = provider === "openai_compatible" && !baseUrl.trim();
  const missingKey = !token.trim() && !cred;
  const canTest = !missingBase && !missingKey && model.trim().length > 0;

  async function test() {
    setBusy("probar");
    setMessage(null);
    const res = await fetch("/api/settings/ai/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body(true),
    }).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      setMessage({
        kind: "error",
        text: await readError(res, "No se pudo probar la conexión"),
      });
      return;
    }
    const data = (await res.json()) as {
      latencyMs: number;
      reactivated: boolean;
      view: View | null;
    };
    if (data.view) setView(data.view);
    setMessage({
      kind: "ok",
      text: data.reactivated
        ? `Conexión correcta (${data.latencyMs} ms). Tu llave vuelve a estar activa.`
        : `Conexión correcta (${data.latencyMs} ms)${token.trim() ? ". Pulsa Guardar para dejarla configurada." : "."}`,
    });
  }

  async function fetchModels() {
    setBusy("modelos");
    setMessage(null);
    const res = await fetch("/api/settings/ai/models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body(false),
    }).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      setMessage({
        kind: "error",
        text: await readError(res, "No se pudo traer la lista de modelos"),
      });
      return;
    }
    const data = (await res.json()) as {
      supported: boolean;
      models: Model[];
      message?: string;
    };
    if (!data.supported) {
      setModels(null);
      setMessage({
        kind: "info",
        text: data.message ?? "Este proveedor no publica su lista de modelos.",
      });
      return;
    }
    setModels(data.models);
    setMessage({
      kind: "info",
      text: `${data.models.length} modelos disponibles: escribe para filtrar en el campo Modelo.`,
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy("guardar");
    setMessage(null);
    const res = await fetch("/api/settings/ai", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: body(true),
    }).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      setMessage({
        kind: "error",
        text: await readError(res, "No se pudo guardar. Revisa los datos e inténtalo de nuevo."),
      });
      return;
    }
    setView((await res.json()) as View);
    // La llave se borra del formulario en cuanto viaja: no tiene por qué
    // seguir en pantalla ni en la memoria de la pestaña.
    setToken("");
    setMessage({
      kind: "ok",
      text: "Guardado. Prueba la conexión y corre el Laboratorio antes de encender el agente con clientes reales.",
    });
  }

  async function remove() {
    setBusy("quitar");
    setMessage(null);
    const res = await fetch("/api/settings/ai", { method: "DELETE" }).catch(
      () => null
    );
    setBusy(null);
    if (!res?.ok) {
      setMessage({ kind: "error", text: "No se pudo quitar la llave." });
      return;
    }
    const data = (await res.json()) as View;
    setView(data);
    setToken("");
    setMessage({
      kind: "info",
      text: data.envFallback
        ? "Llave eliminada. El agente sigue con las variables del entorno de la instancia."
        : "Llave eliminada. Tu agente no puede contestar hasta que configures otra.",
    });
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Proveedor de IA</CardTitle>
          <CardDescription>
            Con qué piensa tu agente: el proveedor, el modelo y la llave que paga
            el consumo. La llave se guarda cifrada y no vuelve a mostrarse
            completa.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {view === null ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : cred ? (
            <SavedStatus cred={cred} view={view} />
          ) : view.envFallback ? (
            <div className="rounded-md border p-3 text-sm">
              <p>
                Hoy el agente usa las variables del entorno de la instancia:{" "}
                <code className="font-mono">{view.envFallback.model || "sin modelo"}</code>{" "}
                con la llave{" "}
                <code className="font-mono">••••{view.envFallback.tokenLast4}</code>.
              </p>
              <p className="mt-1 text-muted-foreground">
                Lo que guardes aquí manda sobre ellas, sin reiniciar nada.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Todavía no hay proveedor de IA: tu agente no puede contestar y los
              mensajes llegan a la bandeja para que los atienda una persona.
            </p>
          )}

          <HelpKey provider={provider} />

          <form onSubmit={save} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ai-provider">Proveedor</Label>
              <select
                id="ai-provider"
                value={provider}
                onChange={(e) => {
                  setProvider(e.target.value as AiProviderId);
                  setModels(null);
                }}
                className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
              >
                {AI_PROVIDERS.map((id) => (
                  <option key={id} value={id}>
                    {AI_PROVIDER_PRESETS[id].label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {preset.baseUrl
                  ? `Habla con ${preset.baseUrl}. Una sola llave da acceso a los modelos de todos los laboratorios.`
                  : "Cualquier API con la forma de la de OpenAI: OpenAI, Groq, Together, un servidor propio…"}
              </p>
            </div>

            {provider === "openai_compatible" && (
              <div className="space-y-1.5">
                <Label htmlFor="ai-base-url">Base URL</Label>
                <Input
                  id="ai-base-url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.openai.com"
                  autoComplete="off"
                />
                <p className="text-xs text-muted-foreground">
                  Con o sin <code className="font-mono">/v1</code> al final: se
                  completa solo.
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="ai-model">Modelo</Label>
              <div className="flex gap-2">
                <Input
                  id="ai-model"
                  list={models ? "ai-modelos" : undefined}
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={preset.modelPlaceholder}
                  autoComplete="off"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={fetchModels}
                  disabled={busy !== null || missingBase || missingKey}
                >
                  {busy === "modelos" ? "Trayendo…" : "Traer modelos"}
                </Button>
              </div>
              {models && (
                <datalist id="ai-modelos">
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name ?? undefined}
                    </option>
                  ))}
                </datalist>
              )}
              <p className="text-xs text-muted-foreground">
                El mismo modelo conversa con tus clientes y juzga en el
                Laboratorio.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ai-token">
                {cred ? "Reemplazar la llave" : "Llave del proveedor"}
              </Label>
              <Input
                id="ai-token"
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={
                  cred ? `•••• ${cred.tokenLast4} (déjalo vacío para conservarla)` : preset.tokenPlaceholder
                }
              />
              <p className="text-xs text-muted-foreground">
                Se guarda cifrada en tu servidor. No la compartas por chat.
              </p>
            </div>

            {message && (
              <p
                role={message.kind === "error" ? "alert" : "status"}
                className={
                  message.kind === "error"
                    ? "text-sm text-danger-text"
                    : message.kind === "ok"
                      ? "text-sm text-success-text"
                      : "text-sm text-muted-foreground"
                }
              >
                {message.text}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={test}
                disabled={busy !== null || !canTest}
              >
                {busy === "probar" ? "Probando…" : "Probar conexión"}
              </Button>
              <Button
                type="submit"
                disabled={busy !== null || !canTest}
              >
                {busy === "guardar" ? "Guardando…" : "Guardar"}
              </Button>
              {cred && (
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

function SavedStatus({ cred, view: view }: { cred: Credential; view: View }) {
  return (
    <div className="rounded-md border p-3 text-sm" data-ai-estado={cred.status}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          Llave conectada: <code className="font-mono">••••{cred.tokenLast4}</code>
          {" · "}
          {AI_PROVIDER_PRESETS[cred.provider].label}
          {" · "}
          <code className="font-mono">{cred.model}</code>
        </span>
        <Badge variant={STATUS_BADGE[cred.status]}>
          {AI_STATUS_LABEL[cred.status]}
        </Badge>
      </div>
      {cred.provider === "openai_compatible" && (
        <p className="mt-1 text-xs text-muted-foreground">{cred.baseUrl}</p>
      )}
      {view.message && (
        <p className="mt-2 text-muted-foreground">{view.message}</p>
      )}
      {cred.reason && (
        <p className="mt-1 text-xs text-muted-foreground">
          El proveedor dijo: {cred.reason}
        </p>
      )}
    </div>
  );
}

/** Lo que hay que saber ANTES de pegar nada. Plegado: no estorba al que ya lo sabe. */
function HelpKey({ provider }: { provider: AiProviderId }) {
  return (
    <details className="rounded-lg border p-3 text-sm">
      <summary className="cursor-pointer font-medium">¿Cómo consigo mi llave?</summary>
      {provider === "openrouter" ? (
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-muted-foreground">
          <li>
            Crea una cuenta del negocio en{" "}
            <a className="underline" href="https://openrouter.ai" target="_blank" rel="noopener noreferrer">
              openrouter.ai
            </a>
            .
          </li>
          <li>
            En{" "}
            <a className="underline" href="https://openrouter.ai/settings/credits" target="_blank" rel="noopener noreferrer">
              Credits
            </a>
            , carga saldo. El consumo se cobra en esa cuenta.
          </li>
          <li>
            Abre{" "}
            <a className="underline" href="https://openrouter.ai/settings/keys" target="_blank" rel="noopener noreferrer">
              Keys
            </a>{" "}
            → Create key y copia la llave.
          </li>
          <li>Pégala aquí, pulsa «Probar conexión» y luego «Guardar».</li>
        </ol>
      ) : (
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-muted-foreground">
          <li>En el panel de tu proveedor, crea una API key con permiso para chat completions.</li>
          <li>Copia su base URL (la raíz de la API, p. ej. <code className="font-mono">https://api.openai.com</code>).</li>
          <li>Pega aquí la base URL, el modelo y la llave; «Probar conexión» confirma que todo encaja.</li>
        </ol>
      )}
      <p className="mt-3 text-muted-foreground">
        Si prefieres dejarlo en el entorno de la instancia (
        <code className="font-mono">OPENROUTER_API_TOKEN</code> y{" "}
        <code className="font-mono">OPENROUTER_MODEL</code>), sigue funcionando
        como respaldo mientras aquí no haya nada guardado.
      </p>
    </details>
  );
}
