import { parseAgendaFlag } from "@/server/agenda/flag";

/**
 * 1023 — Si esta instancia tiene tarjeta de sellos o no (D1).
 *
 * Mismo patrón que la agenda (ADR-001): el código viaja siempre en main y la
 * migración se aplica igual; lo que decide si existe para el usuario es la
 * variable `STAMP_CARD`, con los mismos valores que `AGENDA`. Apagada, no hay
 * pantalla, ni rutas (404), ni frase de alta, ni sección en Resultados.
 */
export function parseStampCardFlag(raw: string | undefined): boolean {
  return parseAgendaFlag(raw);
}

/** Se lee de `process.env` directo, como `agendaEnabled()`. */
export function stampCardEnabled(): boolean {
  return parseStampCardFlag(process.env.STAMP_CARD);
}

/** 404 y no 403: con la bandera apagada, la superficie no existe. */
export function stampCardDisabledResponse(): Response {
  return new Response(null, { status: 404 });
}
