/**
 * 028 — Cómo se lee en pantalla lo que dijo el servicio central. Sin
 * dependencias de servidor: lo usa el componente de Ajustes → Plan.
 */

export type ResultCentral = "ok" | "llave_invalida" | "limite" | "rechazado" | "sin_respuesta";

/** Qué pasó en el último latido, en palabras del dueño (AC3, AC4, AC6). */
export function resultText(result: ResultCentral | null): { tone: "ok" | "aviso" | "error"; text: string } | null {
  switch (result) {
    case null:
      return null;
    case "ok":
      return { tone: "ok", text: "Conectado: el central recibió el último latido." };
    case "llave_invalida":
      return {
        tone: "error",
        text: "El central no reconoce esta llave. Revísala con into o pega la nueva si la rotaron.",
      };
    case "limite":
      return { tone: "aviso", text: "El central pidió esperar un poco: el siguiente latido sale a su hora." };
    case "rechazado":
      return { tone: "error", text: "El central rechazó el latido. Avísale a into." };
    case "sin_respuesta":
      return {
        tone: "aviso",
        text: "Sin respuesta del central. Tu CRM sigue funcionando igual; el siguiente latido sale a su hora.",
      };
  }
}

export const ACCOUNT_LABEL: Record<"active" | "suspended", string> = {
  active: "Activa",
  suspended: "Suspendida",
};

/** El formato de la llave que emite el central (también lo valida la API). */
export const FORMAT_KEY = /^into_live_[0-9A-Za-z]{32}$/;
