"use client";

import { useCallback, useRef, useState } from "react";
import { Gift, Minus, Plus, Stamp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEvents } from "@/components/use-events";
import type { CardView } from "@/server/stamp-card/http";
import { StampCardFace } from "./card-face";

type Message = { kind: "ok" | "error"; text: string };

const time = new Intl.DateTimeFormat("es-PE", {
  timeZone: "America/Lima",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const when = (iso: string) => time.format(new Date(iso)).replace(",", "");

const KIND_LABEL: Record<string, string> = {
  join: "Se unió",
  stamp: "Sello",
  redeem: "Canje",
  adjust: "Ajuste",
};
const SOURCE_LABEL: Record<string, string> = { whatsapp: "por WhatsApp", panel: "desde el CRM", qr: "con el QR" };

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message ?? `Error ${res.status}`;
  } catch {
    return `Error ${res.status}`;
  }
}

/**
 * 1023 — La tarjeta de sellos de un contacto con sus acciones (H4, H5, AC14).
 *
 * La usan la ficha del contacto (`variant="compact"`) y la pantalla del QR
 * del equipo (`variant="full"`). Cada acción lleva su llave de idempotencia y
 * la conserva hasta que el servidor responde bien: un doble toque o un
 * reintento tras un corte no suman dos sellos (AC5). Antes del mínimo de
 * horas, el servidor pide confirmación y se repite con la MISMA llave.
 */
export function StampCardPanel({
  initial,
  contactId,
  canAdjust,
  source = "panel",
  variant = "compact",
}: {
  initial: CardView | null;
  contactId: string;
  canAdjust: boolean;
  source?: "panel" | "qr";
  variant?: "compact" | "full";
}) {
  const [card, setCard] = useState<CardView | null>(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [confirmAt, setConfirmAt] = useState<string | null>(null);
  const pending = useRef<{ action: string; key: string } | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/stamp-card/cards?contactId=${encodeURIComponent(contactId)}`, { cache: "no-store" });
    if (res.ok) setCard(((await res.json()) as { card: CardView | null }).card);
  }, [contactId]);

  useEvents({
    onStampCardUpdated: (d) => {
      if (d.contactId === contactId) void refresh();
    },
    onReconnect: () => void refresh(),
  });

  const keyFor = (action: string) => {
    if (pending.current?.action !== action) pending.current = { action, key: newKey() };
    return pending.current.key;
  };

  async function run(action: "stamp" | "redeem" | "adjust", body: Record<string, unknown> = {}) {
    if (!card) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/stamp-card/cards/${card.id}/${action}${action === "redeem" ? `?source=${source}` : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": keyFor(action + JSON.stringify(body.delta ?? "")) },
        body: JSON.stringify(action === "stamp" ? { ...body, source } : body),
      });
      if (res.status === 409 && action === "stamp") {
        const data = (await res.json()) as { error: { code: string; message: string }; nextAt?: string };
        if (data.error.code === "needs_confirmation" && data.nextAt) {
          setConfirmAt(data.nextAt);
          return;
        }
        setMessage({ kind: "error", text: data.error.message });
        return;
      }
      if (!res.ok) {
        setMessage({ kind: "error", text: await readError(res) });
        return;
      }
      const data = (await res.json()) as { card: CardView; completed?: boolean };
      pending.current = null;
      setConfirmAt(null);
      setCard(data.card);
      setMessage({
        kind: "ok",
        text:
          action === "stamp"
            ? data.completed
              ? "¡Tarjeta completa! Ya puede canjear su premio."
              : `Sello sumado. Faltan ${data.card.stampsLeft}.`
            : action === "redeem"
              ? "Premio canjeado. La tarjeta vuelve a empezar."
              : "Sellos ajustados.",
      });
    } catch {
      setMessage({ kind: "error", text: "Sin conexión. Vuelve a intentarlo: no se sumará dos veces." });
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/stamp-card/cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId }),
      });
      if (!res.ok) {
        setMessage({ kind: "error", text: await readError(res) });
        return;
      }
      setCard(((await res.json()) as { card: CardView }).card);
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!card) return;
    try {
      await navigator.clipboard.writeText(card.publicUrl);
      setMessage({ kind: "ok", text: "Enlace copiado. Envíaselo al cliente." });
    } catch {
      setMessage({ kind: "error", text: card.publicUrl });
    }
  }

  if (!card) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Este contacto todavía no tiene tarjeta de sellos.</p>
        <Button size="sm" variant="outline" onClick={create} disabled={busy}>
          <Stamp className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Crear tarjeta
        </Button>
        {message ? <Feedback message={message} /> : null}
      </div>
    );
  }

  const paused = card.program.status !== "active";
  const large = variant === "full";

  return (
    <div className="space-y-3">
      {large ? (
        <StampCardFace
          name={card.program.name}
          reward={card.program.reward}
          color={card.program.color}
          stamps={card.stamps}
          stampsRequired={card.stampsRequired}
          paused={paused}
        />
      ) : (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
          <span className="text-lg font-bold tabular-nums">
            {card.stamps}/{card.stampsRequired}
          </span>
          <span className="text-muted-foreground">sellos</span>
          <span className="text-muted-foreground">· {card.rewardsRedeemed} canje{card.rewardsRedeemed === 1 ? "" : "s"}</span>
          {card.inWallet ? <span className="text-muted-foreground">· en su wallet</span> : null}
        </div>
      )}

      {card.lastStampAt ? (
        <p className="text-xs text-muted-foreground">Último sello: {when(card.lastStampAt)}</p>
      ) : null}
      {card.consentAt ? (
        <p className="text-xs text-muted-foreground">Aceptó guardarla en su celular: {when(card.consentAt)}</p>
      ) : null}

      {confirmAt ? (
        <div role="alertdialog" aria-label="Confirmar sello" className="space-y-2 rounded-lg border border-warning-soft bg-warning-tint p-3 text-sm text-warning-text">
          <p>
            Ya se sumó un sello hace poco. El siguiente toca desde el {when(confirmAt)}. ¿Sumar otro igual?
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => run("stamp", { force: true })} disabled={busy}>
              Sumar igual
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setConfirmAt(null);
                pending.current = null;
              }}
            >
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}

      <div className={large ? "grid gap-2" : "flex flex-wrap gap-2"}>
        <Button size={large ? "lg" : "sm"} onClick={() => run("stamp")} disabled={busy || paused || !!confirmAt}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Sumar sello
        </Button>
        {card.complete ? (
          <Button size={large ? "lg" : "sm"} variant="secondary" onClick={() => run("redeem")} disabled={busy}>
            <Gift className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Canjear premio
          </Button>
        ) : null}
        {canAdjust && card.stamps > 0 ? (
          <Button size={large ? "lg" : "sm"} variant="ghost" onClick={() => run("adjust", { delta: -1 })} disabled={busy}>
            <Minus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Quitar un sello
          </Button>
        ) : null}
      </div>

      {message ? <Feedback message={message} /> : null}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <a href={card.publicUrl} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
          Ver su tarjeta
        </a>
        <button type="button" onClick={copyLink} className="text-primary underline-offset-2 hover:underline">
          Copiar enlace
        </button>
      </div>

      {card.events && card.events.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Bitácora</summary>
          <ul className="mt-2 space-y-1">
            {card.events.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-x-2 text-xs">
                <span className="tabular-nums text-muted-foreground">{when(e.createdAt)}</span>
                <span className="font-medium">
                  {KIND_LABEL[e.kind]}
                  {e.kind !== "join" ? ` ${e.delta > 0 ? "+" : ""}${e.delta}` : ""}
                </span>
                <span className="text-muted-foreground">
                  {e.userName ?? SOURCE_LABEL[e.source]}
                  {e.forced ? " · confirmado antes de tiempo" : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function Feedback({ message }: { message: Message }) {
  return (
    <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "text-sm text-destructive" : "text-sm text-success-text"}>
      {message.text}
    </p>
  );
}
