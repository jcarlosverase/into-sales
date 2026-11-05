import { LICENSE_ACCOUNT_LABELS, licenseResultNotice, type LicenseResult } from "@into/designsystem";

/**
 * 028 — Cómo se lee en pantalla lo que dijo el servicio central. Sin
 * dependencias de servidor: lo usan Ajustes → Plan y Salud.
 *
 * Spec 1022: los textos son los de `LicenseStatus` del sistema de diseño, los
 * mismos de IntoCredit. Los valores guardados siguen en español (028); aquí se
 * traducen a los del sistema de diseño.
 */

export type ResultCentral = "ok" | "llave_invalida" | "limite" | "rechazado" | "sin_respuesta" | "otro_producto";

export const LICENSE_RESULT: Record<ResultCentral, LicenseResult> = {
  ok: "ok",
  llave_invalida: "invalid_key",
  limite: "rate_limited",
  rechazado: "rejected",
  sin_respuesta: "no_response",
  otro_producto: "wrong_product",
};

const TONE = { success: "ok", warning: "aviso", danger: "error" } as const;

/** Qué pasó en el último latido, en palabras del dueño (AC3, AC4, AC6). */
export function resultText(result: ResultCentral | null): { tone: "ok" | "aviso" | "error"; text: string } | null {
  if (result === null) return null;
  const notice = licenseResultNotice(LICENSE_RESULT[result], "IntoSales");
  return { tone: TONE[notice.tone], text: notice.text };
}

export const ACCOUNT_LABEL: Record<"active" | "suspended", string> = LICENSE_ACCOUNT_LABELS;

/** El formato de la llave que emite el central (también lo valida la API). */
export const FORMAT_KEY = /^into_live_[0-9A-Za-z]{32}$/;
