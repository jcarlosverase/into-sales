import { describe, expect, it } from "vitest";
import {
  SESSION_EXPIRES_IN_SECONDS,
  SESSION_REFRESH_SECONDS,
  shouldRefreshSession,
} from "@/lib/auth/session-policy";

/** Spec 1018 — la sesión se cierra tras 12 horas sin uso. */
describe("la política de la sesión", () => {
  it("vence a las 12 h y se renueva como mucho cada 10 min", () => {
    expect(SESSION_EXPIRES_IN_SECONDS).toBe(12 * 60 * 60);
    expect(SESSION_REFRESH_SECONDS).toBe(10 * 60);
  });

  const t0 = 1_000_000_000_000;
  const min = 60 * 1000;

  it("con actividad real y el intervalo cumplido, renueva", () => {
    expect(shouldRefreshSession({ now: t0 + 11 * min, lastActivityAt: t0 + 5 * min, lastRefreshAt: t0 })).toBe(true);
  });

  it("sin actividad desde la última renovación, NO renueva (la pestaña sola no la mantiene)", () => {
    expect(shouldRefreshSession({ now: t0 + 11 * 60 * min, lastActivityAt: t0 - min, lastRefreshAt: t0 })).toBe(false);
    expect(shouldRefreshSession({ now: t0 + 11 * 60 * min, lastActivityAt: 0, lastRefreshAt: t0 })).toBe(false);
  });

  it("con actividad pero antes de 10 min, espera", () => {
    expect(shouldRefreshSession({ now: t0 + 9 * min, lastActivityAt: t0 + 8 * min, lastRefreshAt: t0 })).toBe(false);
  });
});
