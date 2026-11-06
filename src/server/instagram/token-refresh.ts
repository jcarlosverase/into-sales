import { MetaApiError } from "@/lib/meta/client";
import {
  listConnectedMetaInstagram,
  markInstagramReconnectRequired,
  saveRefreshedInstagramToken,
  type InstagramCredentials,
} from "@/server/instagram/credentials";
import { refreshLongLivedToken } from "@/server/instagram/oauth";

/**
 * 1025 — Renovación automática del token de Instagram.
 *
 * Un token de «Conectar con Instagram» dura 60 días. Cada 6 horas se renuevan
 * los que están a 20 días o menos de vencer, y los de vencimiento desconocido
 * (conectados antes de esta spec o pegados a mano). Un fallo pasajero se
 * reintenta en la siguiente vuelta; el canal sigue atendiendo mientras tanto.
 * Nada de aquí escribe un token en el log.
 */

export const RENEW_BEFORE_DAYS = 20;
export const REFRESH_EVERY_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** OAuthException: el token venció o se revocó. */
const INVALID_TOKEN_CODE = 190;

export function refreshDue(expiresAt: Date | null, now: Date): boolean {
  return expiresAt === null || expiresAt.getTime() - now.getTime() <= RENEW_BEFORE_DAYS * DAY_MS;
}

export type RefreshOutcome = "refreshed" | "not_due" | "failed" | "reconnect_required";

/** Nunca lanza: una cuenta que falla no frena a las demás. */
export async function refreshOne(creds: InstagramCredentials, now: Date): Promise<RefreshOutcome> {
  if (!refreshDue(creds.tokenExpiresAt, now)) return "not_due";
  try {
    const renewed = await refreshLongLivedToken(creds.token);
    await saveRefreshedInstagramToken(creds.id, renewed.token, new Date(now.getTime() + renewed.expiresIn * 1000), now);
    return "refreshed";
  } catch (err) {
    const code = err instanceof MetaApiError ? err.code : null;
    console.warn(`[ig-token] no se pudo renovar (org ${creds.organizationId}, código ${code ?? "?"})`);
    // Solo un token que sabemos de Conectar con Instagram se da por muerto: uno
    // pegado a mano puede no ser renovable y seguir sirviendo para enviar.
    if (code === INVALID_TOKEN_CODE && creds.tokenExpiresAt !== null) {
      await markInstagramReconnectRequired(creds.organizationId);
      return "reconnect_required";
    }
    return "failed";
  }
}

export async function refreshInstagramTokens(now = new Date()): Promise<RefreshOutcome[]> {
  const accounts = await listConnectedMetaInstagram();
  const outcomes: RefreshOutcome[] = [];
  for (const creds of accounts) outcomes.push(await refreshOne(creds, now));
  return outcomes;
}

const globalTimer = globalThis as unknown as { __intoIgTokenRefresh?: ReturnType<typeof setInterval> };

/** Corre al arrancar y cada 6 horas. La base puede no estar lista: se reintenta. */
export function startInstagramTokenRefresh(): void {
  if (globalTimer.__intoIgTokenRefresh) return;
  const round = () =>
    void refreshInstagramTokens().catch((err) => {
      console.warn(`[ig-token] la vuelta falló: ${err instanceof Error ? err.name : "Error"}`);
    });
  globalTimer.__intoIgTokenRefresh = setInterval(round, REFRESH_EVERY_MS);
  globalTimer.__intoIgTokenRefresh.unref?.();
  round();
}
