import { getEnv } from "@/lib/env";
import { publicTokenFor } from "./tokens";

/**
 * 1023 — Los enlaces de una tarjeta. Viven aparte de `cards.ts` para que
 * `google-pass.ts` los use sin importar `cards.ts`, que a su vez importa
 * `wallet-sync.ts` (y este, `google-pass.ts`): sin ese ciclo.
 */

/** El enlace público de la tarjeta (D5). Se puede volver a dar: el token se deriva. */
export function publicCardUrl(cardId: string): string {
  return `${getEnv().APP_BASE_URL.replace(/\/+$/, "")}/c/${publicTokenFor(cardId)}`;
}

/** Lo que el QR de la tarjeta lleva: la pantalla del equipo para sellar (D6). */
export function staffCardUrl(serial: string): string {
  return `${getEnv().APP_BASE_URL.replace(/\/+$/, "")}/s/${serial}`;
}
