"use client";

import { useEffect, useRef } from "react";
import { shouldRefreshSession } from "@/lib/auth/session-policy";

/** Lo que cuenta como que alguien está usando el CRM (spec 1018, AC3). */
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "touchstart", "wheel"] as const;
const CHECK_EVERY_MS = 60 * 1000;

/**
 * Spec 1018 — Mantiene viva la sesión mientras alguien trabaja.
 *
 * El CRM lee la sesión en el servidor, y ahí Better Auth no puede reescribir
 * la cookie: sin esto, la cookie vencería a las 12 h de entrar aunque la
 * persona siguiera atendiendo. Con actividad real desde la última renovación,
 * cada minuto se revisa si toca renovar (`shouldRefreshSession`) y se pide
 * `/api/auth/get-session`, que renueva la fila y la cookie. Si la sesión ya no
 * existe, lleva al inicio de sesión.
 */
export function SessionKeepAlive() {
  const lastActivity = useRef(0);
  const lastRefresh = useRef(Date.now());
  const busy = useRef(false);

  useEffect(() => {
    const markActive = () => {
      lastActivity.current = Date.now();
    };
    for (const name of ACTIVITY_EVENTS) {
      window.addEventListener(name, markActive, { passive: true, capture: true });
    }

    const tick = async () => {
      if (busy.current) return;
      const now = Date.now();
      if (
        !shouldRefreshSession({
          now,
          lastActivityAt: lastActivity.current,
          lastRefreshAt: lastRefresh.current,
        })
      ) {
        return;
      }
      busy.current = true;
      try {
        const res = await fetch("/api/auth/get-session", { cache: "no-store" });
        if (!res.ok) return; // hipo de red: se reintenta en el próximo minuto
        lastRefresh.current = now;
        const session = await res.json().catch(() => null);
        if (!session) window.location.assign("/login");
      } catch {
        // sin conexión: se reintenta en el próximo minuto
      } finally {
        busy.current = false;
      }
    };
    const timer = window.setInterval(() => void tick(), CHECK_EVERY_MS);

    return () => {
      window.clearInterval(timer);
      for (const name of ACTIVITY_EVENTS) {
        window.removeEventListener(name, markActive, { capture: true });
      }
    };
  }, []);

  return null;
}
