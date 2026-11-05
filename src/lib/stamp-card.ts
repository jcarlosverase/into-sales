import { z } from "zod";

/**
 * 1023 — Reglas puras de la tarjeta de sellos. Sin base de datos ni Next:
 * las comparten el servidor (dominio y API) y la pantalla de Ajustes.
 */

export const DEFAULT_JOIN_PHRASE = "Quiero mi tarjeta de sellos";
export const DEFAULT_JOIN_REPLY =
  "¡Hola {nombre}! Esta es tu tarjeta de sellos de {negocio}: {enlace}\nGuárdala en tu celular y muéstrala en cada visita.";
export const DEFAULT_PROGRAM_COLOR = "#0070e0";

export const PROGRAM_LIMITS = {
  name: 40,
  reward: 60,
  terms: 300,
  joinPhrase: 80,
  joinReply: 500,
  minStamps: 2,
  maxStamps: 30,
  maxMinHours: 168,
} as const;

const trimmed = (max: number, label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} no puede ir vacío`)
    .max(max, `${label}: máximo ${max} caracteres`);

/** AC2 — lo que guarda `PUT /api/stamp-card/program`. */
export const programInputSchema = z
  .object({
    name: trimmed(PROGRAM_LIMITS.name, "El nombre"),
    stampsRequired: z
      .number()
      .int()
      .min(PROGRAM_LIMITS.minStamps)
      .max(PROGRAM_LIMITS.maxStamps),
    reward: trimmed(PROGRAM_LIMITS.reward, "El premio"),
    terms: z
      .string()
      .trim()
      .max(PROGRAM_LIMITS.terms, `Las condiciones: máximo ${PROGRAM_LIMITS.terms} caracteres`)
      .nullish()
      .transform((v) => (v ? v : null)),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "El color va como #RRGGBB")
      .transform((v) => v.toLowerCase()),
    minHoursBetweenStamps: z.number().int().min(0).max(PROGRAM_LIMITS.maxMinHours),
    joinPhrase: trimmed(PROGRAM_LIMITS.joinPhrase, "La frase de alta").refine(
      (v) => normalizePhrase(v).length > 0,
      "La frase de alta necesita letras o números"
    ),
    joinReply: trimmed(PROGRAM_LIMITS.joinReply, "La respuesta de alta").refine(
      (v) => v.includes("{enlace}"),
      "La respuesta de alta debe llevar {enlace}"
    ),
    status: z.enum(["active", "paused"]),
    /** D10 — Avisar por WhatsApp al completar la tarjeta. Viene apagado. */
    notifyOnComplete: z.boolean().default(false),
    /** D10 — Plantilla aprobada para cuando la ventana de 24 horas está cerrada. */
    completeTemplateId: z
      .string()
      .max(64)
      .nullish()
      .transform((v) => (v ? v : null)),
  })
  .strict();

export type ProgramInput = z.infer<typeof programInputSchema>;

/** D10 — El texto del aviso cuando la ventana de 24 horas está abierta. */
export function completeNotice(values: { nombre: string; negocio: string; premio: string }): string {
  const hola = values.nombre ? `¡${values.nombre}, completaste` : "¡Completaste";
  return `${hola} tu tarjeta de sellos de ${values.negocio}! 🎉 Pide tu premio en tu próxima visita: ${values.premio}.`;
}

/**
 * D4 — La frase se compara sin mayúsculas, tildes, signos ni espacios de más:
 * «¡Quiero mi TARJETA de sellos!» es la misma que «quiero mi tarjeta de sellos».
 */
export function normalizePhrase(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function matchesJoinPhrase(text: string, phrase: string): boolean {
  const want = normalizePhrase(phrase);
  return want.length > 0 && normalizePhrase(text) === want;
}

export type StampCheck =
  | { ok: true }
  | { ok: false; reason: "too_soon"; nextAt: Date };

/** D7 — ¿Se puede sumar un sello sin pedir confirmación? */
export function canStamp(lastStampAt: Date | null, minHours: number, now: Date): StampCheck {
  if (!lastStampAt || minHours <= 0) return { ok: true };
  const nextAt = new Date(lastStampAt.getTime() + minHours * 3_600_000);
  return now.getTime() >= nextAt.getTime() ? { ok: true } : { ok: false, reason: "too_soon", nextAt };
}

export type CardCounts = { stamps: number; stampsRequired: number };

/** Un sello más. Pasarse del total vale: el sobrante va al siguiente ciclo (H5). */
export function applyStamp(card: CardCounts): CardCounts & { complete: boolean } {
  const stamps = card.stamps + 1;
  return { stamps, stampsRequired: card.stampsRequired, complete: stamps >= card.stampsRequired };
}

export type RedeemResult =
  | { ok: true; stamps: number; stampsRequired: number; delta: number }
  | { ok: false; reason: "not_complete" };

/**
 * H5 — Canjear resta los sellos del ciclo; el sobrante pasa al siguiente,
 * que ya usa los sellos que pide el programa hoy (D3).
 */
export function applyRedeem(card: CardCounts, programStampsRequired: number): RedeemResult {
  if (card.stamps < card.stampsRequired) return { ok: false, reason: "not_complete" };
  return {
    ok: true,
    stamps: card.stamps - card.stampsRequired,
    stampsRequired: programStampsRequired,
    delta: -card.stampsRequired,
  };
}

/** Un ajuste manual nunca deja sellos negativos. */
export function applyAdjust(card: CardCounts, delta: number): { stamps: number; delta: number } {
  const stamps = Math.max(0, card.stamps + delta);
  return { stamps, delta: stamps - card.stamps };
}

export function isComplete(card: CardCounts): boolean {
  return card.stamps >= card.stampsRequired;
}

export function stampsLeft(card: CardCounts): number {
  return Math.max(0, card.stampsRequired - card.stamps);
}

/**
 * D4 — `{nombre}`, `{negocio}` y `{enlace}`; lo demás queda tal cual. Sin
 * nombre (un contacto que solo tiene teléfono), `{nombre}` se va con el
 * espacio de delante: «Hola {nombre}, …» queda «Hola, …».
 */
export function renderJoinReply(
  template: string,
  values: { nombre: string; negocio: string; enlace: string }
): string {
  const base = values.nombre ? template : template.replace(/[ \t]*\{nombre\}/g, "");
  return base.replace(/\{(nombre|negocio|enlace)\}/g, (_, key: keyof typeof values) => values[key]);
}

/** El enlace de WhatsApp del cartel del mostrador: abre el chat con la frase escrita. */
export function waJoinLink(phoneDigits: string, phrase: string): string {
  return `https://wa.me/${phoneDigits.replace(/\D/g, "")}?text=${encodeURIComponent(phrase)}`;
}

export type WalletPlatform = "ios" | "android" | "other";

/**
 * El sistema del celular, por su `User-Agent`: en un iPhone solo se ofrece
 * Apple Wallet y en un Android solo Google Wallet. En una computadora (o un
 * iPad que se presenta como Mac) se ofrecen los dos.
 */
export function walletPlatform(userAgent: string | null | undefined): WalletPlatform {
  const ua = userAgent ?? "";
  if (/\b(iPhone|iPad|iPod)\b/.test(ua)) return "ios";
  if (/\bAndroid\b/.test(ua)) return "android";
  return "other";
}
