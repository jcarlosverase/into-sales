"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Printer } from "lucide-react";
import { BrandTile } from "@/components/brand-mark";
import { StampCardFace } from "@/components/stamp-card/card-face";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { Branding } from "@/lib/branding";
import { qrSvg } from "@/lib/qr";
import { PROGRAM_LIMITS, programInputSchema, waJoinLink, type ProgramInput } from "@/lib/stamp-card";

type Message = { kind: "ok" | "error"; text: string };

/**
 * 1023, H1 y AC13 — Ajustes → Tarjeta de sellos: el programa, su vista previa,
 * el cartel del mostrador y el enlace para grabar en un sticker NFC.
 * Valida con el mismo esquema que la API, así el error se ve antes de guardar.
 */
export function StampCardSettings({
  initial,
  saved: initiallySaved,
  canEdit,
  whatsAppDigits,
  branding,
}: {
  initial: ProgramInput;
  saved: boolean;
  canEdit: boolean;
  whatsAppDigits: string | null;
  branding: Pick<Branding, "name" | "accent" | "favicon">;
}) {
  const router = useRouter();
  const [form, setForm] = useState<ProgramInput>(initial);
  const [saved, setSaved] = useState(initiallySaved);
  const [savedPhrase, setSavedPhrase] = useState(initiallySaved ? initial.joinPhrase : null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  const set = <K extends keyof ProgramInput>(key: K, value: ProgramInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const parsed = programInputSchema.safeParse(form);
  const problem = parsed.success ? null : parsed.error.issues[0]?.message ?? "Revisa los campos";

  // El cartel usa la frase GUARDADA: la que el CRM reconoce de verdad.
  const joinLink = whatsAppDigits && savedPhrase ? waJoinLink(whatsAppDigits, savedPhrase) : null;
  const qr = useMemo(() => (joinLink ? qrSvg(joinLink) : null), [joinLink]);

  async function save() {
    if (!parsed.success) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/stamp-card/program", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setMessage({ kind: "error", text: body?.error?.message ?? `Error ${res.status}` });
        return;
      }
      setSaved(true);
      setSavedPhrase(parsed.data.joinPhrase);
      setMessage({ kind: "ok", text: "Tarjeta guardada." });
      router.refresh();
    } catch {
      setMessage({ kind: "error", text: "Sin conexión. Vuelve a intentarlo." });
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setMessage({ kind: "ok", text: "Enlace copiado." });
    } catch {
      setMessage({ kind: "error", text: "No se pudo copiar: selecciónalo a mano." });
    }
  }

  const disabled = !canEdit || busy;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader>
            <CardTitle>Tarjeta de sellos</CardTitle>
            <CardDescription>
              Tus clientes se unen escribiendo la frase por WhatsApp y reciben el enlace a su tarjeta. El equipo
              suma los sellos desde la ficha del contacto o escaneando el QR de la tarjeta.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!canEdit ? (
              <p className="text-sm text-muted-foreground">Solo quien administra el negocio puede cambiar la tarjeta.</p>
            ) : null}

            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{form.status === "active" ? "Activa" : "En pausa"}</p>
                <p className="text-xs text-muted-foreground">En pausa no se suman sellos ni se une nadie por WhatsApp.</p>
              </div>
              <Switch
                checked={form.status === "active"}
                onCheckedChange={(on) => set("status", on ? "active" : "paused")}
                label="Tarjeta activa"
                disabled={disabled}
              />
            </div>

            <Field id="sc-name" label="Nombre en la tarjeta" hint={`Hasta ${PROGRAM_LIMITS.name} caracteres`}>
              <Input id="sc-name" value={form.name} maxLength={PROGRAM_LIMITS.name} disabled={disabled} onChange={(e) => set("name", e.target.value)} />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="sc-stamps" label="Sellos para completarla" hint="De 2 a 30">
                <Input
                  id="sc-stamps"
                  type="number"
                  inputMode="numeric"
                  min={PROGRAM_LIMITS.minStamps}
                  max={PROGRAM_LIMITS.maxStamps}
                  value={Number.isFinite(form.stampsRequired) ? form.stampsRequired : ""}
                  disabled={disabled}
                  onChange={(e) => set("stampsRequired", e.target.valueAsNumber)}
                />
              </Field>
              <Field id="sc-hours" label="Horas mínimas entre sellos" hint="0 = sin límite; antes de tiempo se pide confirmar">
                <Input
                  id="sc-hours"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={PROGRAM_LIMITS.maxMinHours}
                  value={Number.isFinite(form.minHoursBetweenStamps) ? form.minHoursBetweenStamps : ""}
                  disabled={disabled}
                  onChange={(e) => set("minHoursBetweenStamps", e.target.valueAsNumber)}
                />
              </Field>
            </div>

            <Field id="sc-reward" label="Premio" hint="Por ejemplo, «1 bebida gratis»">
              <Input id="sc-reward" value={form.reward} maxLength={PROGRAM_LIMITS.reward} disabled={disabled} onChange={(e) => set("reward", e.target.value)} />
            </Field>

            <Field id="sc-terms" label="Condiciones (opcional)" hint={`Hasta ${PROGRAM_LIMITS.terms} caracteres`}>
              <Textarea
                id="sc-terms"
                rows={2}
                value={form.terms ?? ""}
                maxLength={PROGRAM_LIMITS.terms}
                disabled={disabled}
                onChange={(e) => set("terms", e.target.value)}
              />
            </Field>

            <Field id="sc-color" label="Color de la tarjeta">
              <div className="flex items-center gap-2">
                <input
                  id="sc-color"
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(form.color) ? form.color : "#000000"}
                  disabled={disabled}
                  onChange={(e) => set("color", e.target.value)}
                  className="h-9 w-12 shrink-0 cursor-pointer rounded-md border bg-transparent p-1"
                />
                <Input aria-label="Color en hexadecimal" value={form.color} maxLength={7} disabled={disabled} onChange={(e) => set("color", e.target.value)} className="w-28" />
              </div>
            </Field>

            <Field id="sc-phrase" label="Frase de alta" hint="El cliente la envía por WhatsApp. Se compara sin mayúsculas, tildes ni signos.">
              <Input id="sc-phrase" value={form.joinPhrase} maxLength={PROGRAM_LIMITS.joinPhrase} disabled={disabled} onChange={(e) => set("joinPhrase", e.target.value)} />
            </Field>

            <Field id="sc-reply" label="Respuesta de alta" hint="Usa {nombre}, {negocio} y {enlace}. El {enlace} es obligatorio.">
              <Textarea
                id="sc-reply"
                rows={3}
                value={form.joinReply}
                maxLength={PROGRAM_LIMITS.joinReply}
                disabled={disabled}
                onChange={(e) => set("joinReply", e.target.value)}
              />
            </Field>

            {canEdit ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={save} disabled={busy || !parsed.success}>
                  {saved ? "Guardar cambios" : "Crear tarjeta"}
                </Button>
                {problem ? <p className="text-sm text-destructive">{problem}</p> : null}
              </div>
            ) : null}
            {message ? (
              <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "text-sm text-destructive" : "text-sm text-success-text"}>
                {message.text}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <div className="space-y-2">
          <p className="kicker">Vista previa</p>
          <StampCardFace
            name={form.name || "Tu negocio"}
            reward={form.reward || "Tu premio"}
            color={/^#[0-9a-fA-F]{6}$/.test(form.color) ? form.color : "#000000"}
            stamps={Math.min(4, Math.max(0, (form.stampsRequired || 10) - 1))}
            stampsRequired={Math.min(30, Math.max(2, form.stampsRequired || 10))}
            paused={form.status === "paused"}
            logo={<BrandTile branding={branding} className="h-10 w-10 rounded-xl bg-white text-lg" />}
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cartel del mostrador</CardTitle>
          <CardDescription>
            El QR abre WhatsApp con la frase escrita. El mismo enlace sirve para grabarlo en un sticker NFC
            (NTAG213) con una app como NFC Tools: el cliente acerca su celular y se abre el chat.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!saved ? (
            <p className="text-sm text-muted-foreground">Guarda la tarjeta para generar el cartel.</p>
          ) : !whatsAppDigits ? (
            <p className="text-sm text-muted-foreground">
              Conecta tu número en Ajustes → WhatsApp para generar el cartel: el QR lleva a ese número.
            </p>
          ) : (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              {qr ? (
                <div className="w-40 shrink-0 self-center rounded-lg border bg-white p-2 sm:self-start" dangerouslySetInnerHTML={{ __html: qr }} />
              ) : null}
              <div className="min-w-0 space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="sc-nfc">Enlace para el QR y el sticker NFC</Label>
                  <div className="flex gap-2">
                    <Input id="sc-nfc" readOnly value={joinLink ?? ""} className="min-w-0 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                    <Button variant="outline" size="sm" className="h-9 shrink-0" onClick={() => joinLink && copy(joinLink)}>
                      Copiar
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a
                    href="/api/stamp-card/poster"
                    download="cartel-tarjeta-de-sellos.png"
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    Descargar PNG
                  </a>
                  <a
                    href="/stamp-card/poster"
                    target="_blank"
                    rel="noreferrer"
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    <Printer className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    Imprimir o guardar en PDF
                  </a>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
