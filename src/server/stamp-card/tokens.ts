import { createHash, createHmac } from "node:crypto";
import { customAlphabet } from "nanoid";
import { getEnv } from "@/lib/env";

/**
 * 1023 — Los secretos de una tarjeta, sin guardarlos en claro (D5).
 *
 * El token público de `/c/<token>` y el `authenticationToken` del pase de
 * Apple se DERIVAN de la tarjeta con un HMAC sobre `ENCRYPTION_KEY`: la base
 * guarda solo su SHA-256, pero el servidor puede volver a dar el mismo enlace
 * (al repetir la frase de alta o desde la ficha) sin rotarlo. 128 bits cada
 * uno. Cambiar `ENCRYPTION_KEY` ya invalida los tokens de WhatsApp: también
 * invalida estos enlaces, y es lo correcto.
 */

/** 22 caracteres alfanuméricos (≈131 bits): va en el QR del equipo, no es secreto. */
const serialAlphabet = customAlphabet("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz", 22);

export function newSerial(): string {
  return serialAlphabet();
}

function derive(label: string, cardId: string): string {
  const key = Buffer.from(getEnv().ENCRYPTION_KEY, "base64");
  return createHmac("sha256", key).update(`${label}:${cardId}`).digest().subarray(0, 16).toString("base64url");
}

export function publicTokenFor(cardId: string): string {
  return derive("stamp-card-public", cardId);
}

export function appleAuthTokenFor(cardId: string): string {
  return derive("stamp-card-apple-auth", cardId);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Forma de un token público: rechaza basura antes de tocar la base. */
export const PUBLIC_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;
export const SERIAL_PATTERN = /^[A-Za-z0-9]{22}$/;
