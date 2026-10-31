"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Copy, Info, Instagram } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ZernioConnect } from "@/components/settings/zernio-connect";
import { cn } from "@/lib/utils";

/**
 * 023 — Conexión del canal de Instagram: la pantalla que faltaba.
 *
 * `PUT /api/settings/instagram` y el webhook existen desde la 014, pero el
 * canal solo se podía conectar llamando a la API a mano. Gemela de la de
 * Messenger y con las mismas reglas: se prueba contra la plataforma ANTES de
 * guardar, el token se cifra, hacia fuera solo se enseña su cola, y la
 * pantalla solo existe si el canal está encendido con `CHANNELS` (ADR-001).
 */

type Source = "zernio" | "meta";

type Connection = {
  source: Source;
  igUserId: string;
  accountRef: string | null;
  username: string | null;
  /** Spec 1017: foto de perfil de la cuenta conectada por Meta (en vivo). */
  profilePictureUrl?: string | null;
  status: "connected" | "reconnect_required";
  tokenLast4: string;
};

/** Spec 1017: si «Conectar con Instagram» está disponible y su URL de vuelta. */
type OAuthInfo = { available: boolean; redirectUri: string };

/** Spec 1017: el resultado de la vuelta del inicio de sesión (`?ig=`). */
const OAUTH_OUTCOME: Record<string, { ok: boolean; message: string }> = {
  connected: { ok: true, message: "Cuenta de Instagram conectada." },
  connected_no_webhook: {
    ok: false,
    message:
      "La cuenta quedó conectada, pero Meta no aceptó suscribirla al webhook: actívala en tu app (Instagram → Configuración de la API → «Suscripción a webhook») o vuelve a conectar.",
  },
  denied: { ok: false, message: "Se canceló el inicio de sesión de Instagram: no se conectó nada." },
  bad_state: {
    ok: false,
    message: "El inicio de sesión tardó demasiado o se abrió desde otra pestaña. Vuelve a pulsar «Conectar con Instagram».",
  },
  not_configured: {
    ok: false,
    message: "Falta INSTAGRAM_APP_ID o INSTAGRAM_APP_SECRET en la instancia.",
  },
  forbidden: { ok: false, message: "Solo el propietario puede conectar Instagram." },
  meta_error: {
    ok: false,
    message:
      "Instagram rechazó la conexión. Revisa que la URL de vuelta de abajo esté registrada en tu app de Meta y que la cuenta sea profesional.",
  },
  meta_unavailable: { ok: false, message: "Instagram no respondió. Inténtalo de nuevo en unos minutos." },
};
type WebhookInfo = {
  instagramUrl: string | null;
  verifyToken: string;
  signatureLayer: boolean;
};

const HELP: Record<Source, { title: string; items: string[] }> = {
  zernio: {
    title: "Vincula tu Instagram en Zernio y pega aquí tu API key",
    items: [
      "La cuenta se vincula en el panel de Zernio (Accounts → Connect), no desde aquí. Tiene que ser una cuenta profesional: de empresa o de creador.",
      "La API key se crea en Zernio → Settings → API Keys y se muestra una sola vez (empieza con sk_).",
    ],
  },
  meta: {
    title: "Crea una app en developers.facebook.com con el producto Instagram",
    items: [
      "La cuenta tiene que estar en modo profesional (Empresa o Creador).",
      "Con «Conectar con Instagram» entras con la cuenta del negocio y listo. Como alternativa, pega un token generado en tu app: Instagram → Configuración de la API con inicio de sesión de Instagram → «Generar token» (permisos instagram_business_basic e instagram_business_manage_messages).",
      "Sin App Review, la cuenta solo recibe mensajes de perfiles con un rol en la app (administradores, desarrolladores, testers).",
    ],
  },
};

export function InstagramClient() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [webhook, setWebhook] = useState<WebhookInfo | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [source, setSource] = useState<Source>("zernio");
  const [igUserId, setIgUserId] = useState("");
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [copied, setCopied] = useState<"url" | "token" | "redirect" | null>(null);
  const [oauth, setOAuth] = useState<OAuthInfo | null>(null);
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);

  const refetch = useCallback(async () => {
    const [c, w] = await Promise.all([
      fetch("/api/settings/instagram").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/settings/webhook").then((r) => (r.ok ? r.json() : null)),
    ]).catch(() => [null, null]);
    if (c) {
      setConnection(c.connection);
      setOAuth(c.oauth ?? null);
      if (c.connection) {
        setSource(c.connection.source);
        if (c.connection.source === "meta") setIgUserId(c.connection.igUserId);
      }
    }
    if (w) setWebhook(w);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Spec 1017: la vuelta del inicio de sesión llega con `?ig=`. Se cuenta una
  // vez y se limpia la URL, para que recargar no repita el aviso.
  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("ig");
    if (!code) return;
    setOutcome(OAUTH_OUTCOME[code] ?? null);
    setSource("meta");
    url.searchParams.delete("ig");
    window.history.replaceState(null, "", url.pathname + url.search);
  }, []);

  async function saveMeta() {
    setSaving(true);
    setError(null);
    setSaved(null);
    const res = await fetch("/api/settings/instagram", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "meta",
        igUserId: igUserId.trim() || null,
        token: token.trim(),
      }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo conectar la cuenta");
      return;
    }
    const data = (await res.json()) as { username?: string | null };
    setToken("");
    setSaved(data.username ? `Cuenta conectada: @${data.username}` : "Conexión guardada");
    void refetch();
  }

  async function copy(text: string, what: "url" | "token" | "redirect") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // sin portapapeles (contexto no seguro): el texto sigue visible
    }
  }

  if (!loaded) return <p className="text-sm text-muted-foreground">Cargando…</p>;

  const help = HELP[source];
  // Spec 1011: el ID de la cuenta sale del token; el campo es opcional.
  const canSaveMeta = token.trim().length > 0;

  return (
    <div className="max-w-3xl space-y-6">
      {connection?.status === "reconnect_required" && (
        <div className="flex items-start gap-2 rounded-lg border border-danger-soft bg-danger-tint p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-danger-text">
              {connection.source === "zernio"
                ? "La API key de Zernio expiró o fue revocada."
                : "El token expiró o fue revocado."}
            </p>
            <p className="text-danger-text opacity-80">
              Los envíos por Instagram están pausados. Vuelve a conectar abajo.
            </p>
          </div>
        </div>
      )}

      {outcome && (
        <p
          role="status"
          className={cn(
            "flex items-start gap-2 rounded-lg border p-3 text-sm",
            outcome.ok
              ? "border-success-soft bg-success-tint text-success-text"
              : "border-warning-soft bg-warning-tint text-warning-text"
          )}
        >
          {outcome.ok ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          {outcome.message}
        </p>
      )}

      {connection?.status === "connected" && (
        <div className="flex items-center gap-3 rounded-lg border border-success-soft bg-success-tint p-4">
          {connection.profilePictureUrl ? (
            // La URL de Instagram caduca: sin next/image, que la cachearía.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={connection.profilePictureUrl}
              alt={connection.username ? `Foto de perfil de @${connection.username}` : "Foto de perfil"}
              className="h-10 w-10 shrink-0 rounded-full border border-success-soft object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <CheckCircle2 className="h-5 w-5 text-success" />
          )}
          <div className="flex-1 text-sm">
            <p className="font-medium text-success-text">
              Conectado por {connection.source === "zernio" ? "Zernio" : "Meta"}
              {connection.username ? `: @${connection.username}` : ""}
            </p>
            <p className="text-success-text opacity-80">
              {connection.source === "zernio"
                ? `Cuenta ${connection.accountRef}`
                : `Cuenta ${connection.igUserId}`}{" "}
              · {connection.source === "zernio" ? "llave" : "token"} que termina en ····
              {connection.tokenLast4}
            </p>
          </div>
          <Badge variant="success">Instagram activo</Badge>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            {connection ? "Reconectar Instagram" : "Conectar Instagram"}
          </CardTitle>
          <CardDescription>
            Los mensajes directos de tu cuenta entran a la misma bandeja que
            WhatsApp, con su distintivo de canal. {help.title}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>¿De dónde llegan los mensajes?</Label>
            <div className="flex flex-wrap gap-2">
              {(["zernio", "meta"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSource(s)}
                  aria-pressed={source === s}
                  className={cn(
                    "rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors",
                    source === s
                      ? "border-brand bg-brand-tint text-brand-text"
                      : "border-border-strong hover:bg-accent"
                  )}
                >
                  {s === "zernio" ? "Zernio (API unificada)" : "App propia de Meta"}
                </button>
              ))}
            </div>
          </div>

          <ul className="list-disc space-y-1 pl-5 text-xs text-text-2">
            {help.items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>

          {source === "zernio" ? (
            <ZernioConnect
              endpoint="/api/settings/instagram"
              extraBody={{ source: "zernio" }}
              what="tu cuenta de Instagram"
              idPrefix="ig"
              onSaved={() => void refetch()}
            />
          ) : (
            <>
              {oauth?.available ? (
                <div className="space-y-2">
                  {/* Un enlace y no un fetch: la ida al inicio de sesión de
                      Instagram es una navegación completa. */}
                  <a href="/api/settings/instagram/oauth/start" className={buttonVariants()}>
                    <Instagram className="h-4 w-4" aria-hidden />
                    Conectar con Instagram
                  </a>
                  <p className="text-xs text-text-2">
                    Entras con la cuenta de Instagram del negocio y vuelves aquí
                    con la cuenta conectada. También puedes pegar un token abajo.
                  </p>
                </div>
              ) : (
                <p className="flex items-start gap-2 text-xs text-text-2">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Para conectar con un botón, define INSTAGRAM_APP_ID e
                  INSTAGRAM_APP_SECRET en la instancia (el ID y la clave de la
                  app de Instagram, no los de la app de Meta). Mientras tanto,
                  pega un token.
                </p>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="ig-user-id">ID de la cuenta de Instagram (opcional)</Label>
                  <Input
                    id="ig-user-id"
                    value={igUserId}
                    onChange={(e) => setIgUserId(e.target.value)}
                    placeholder="Se toma del token"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ig-token">Token de acceso</Label>
                  <Input
                    id="ig-token"
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="IGAA…"
                    autoComplete="off"
                  />
                </div>
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}
              {saved && <p className="text-sm text-success-text">{saved} ✓</p>}

              <Button
                variant={oauth?.available ? "outline" : "default"}
                disabled={saving || !canSaveMeta}
                onClick={() => void saveMeta()}
              >
                {saving ? "Probando…" : "Probar y guardar"}
              </Button>

              {oauth && (
                <div className="space-y-1.5">
                  <Label>URL de vuelta del inicio de sesión</Label>
                  <div className="flex gap-2">
                    <Input readOnly value={oauth.redirectUri} className="font-mono text-xs" />
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="Copiar la URL de vuelta"
                      onClick={() => void copy(oauth.redirectUri, "redirect")}
                    >
                      {copied === "redirect" ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="text-xs text-text-2">
                    Regístrala en tu app de Meta: Casos de uso → Instagram →
                    Configuración de la API con inicio de sesión de Instagram →
                    «Configura un inicio de sesión empresarial de Instagram» →
                    URL de redireccionamiento de OAuth.
                  </p>
                </div>
              )}
            </>
          )}

          <p className="flex items-start gap-2 text-xs text-text-2">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            A la bandeja entran los mensajes directos; los comentarios de tus
            publicaciones no. Instagram no necesita una página de Facebook
            vinculada: eso solo lo pide Messenger.
          </p>
        </CardContent>
      </Card>

      {source === "zernio" ? (
        <p className="flex items-start gap-2 text-xs text-text-2">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            El webhook lo da de alta IntoSales en tu Zernio al conectar, limitado a
            tus cuentas. Si un día dejan de llegar mensajes, revisa{" "}
            <Link href="/settings/channels" className="font-semibold underline">
              el estado de los canales
            </Link>
            .
          </span>
        </p>
      ) : (
        webhook?.instagramUrl && (
          <Card>
            <CardHeader>
              <CardTitle>Webhook de Instagram</CardTitle>
              <CardDescription>
                En tu app de Meta: Instagram → Configuración → Webhooks. Objeto{" "}
                <code>instagram</code>, campo <code>messages</code>. Pega esta
                URL y este token de verificación.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label>URL de callback</Label>
                <div className="flex gap-2">
                  <Input readOnly value={webhook.instagramUrl} className="font-mono text-xs" />
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Copiar la URL"
                    onClick={() => void copy(webhook.instagramUrl!, "url")}
                  >
                    {copied === "url" ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Token de verificación</Label>
                <div className="flex gap-2">
                  <Input readOnly value={webhook.verifyToken} className="font-mono text-xs" />
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Copiar el token de verificación"
                    onClick={() => void copy(webhook.verifyToken, "token")}
                  >
                    {copied === "token" ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <p className="flex items-start gap-2 text-xs text-text-2">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {webhook.signatureLayer
                  ? "Cada entrega se verifica con la firma del App Secret de tu app."
                  : "Define META_APP_SECRET en la instancia para que además se verifique la firma de cada entrega."}
              </p>
            </CardContent>
          </Card>
        )
      )}
    </div>
  );
}
