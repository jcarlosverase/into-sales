import { z } from "zod";
import type { CentralResult } from "@/lib/db/schema";

/**
 * 028 — Adaptador del servicio central (contrato `POST /v1/heartbeat` de
 * into-central, spec 001). El dominio no conoce al central: le pasa un cuerpo
 * y recibe un resultado.
 *
 * Constitución I: la llave va SOLO en la cabecera. Ningún error lleva la llave
 * ni la URL completa; lo que sale de aquí es un resultado cerrado.
 */

export const CHECK_IDS = ["database", "media_dir", "whatsapp", "ai", "dispatch"] as const;
export type CheckId = (typeof CHECK_IDS)[number];
export type CheckStatus = "ok" | "warn" | "fail" | "skip";

export type BodyHeartbeat = {
  app_version: string;
  app_commit?: string;
  app_started_at: string;
  checks: { id: CheckId; status: CheckStatus }[];
};

const responseSchema = z.object({
  customer: z.object({ name: z.string(), status: z.enum(["active", "suspended"]) }),
  plan: z.object({ code: z.string(), name: z.string() }),
  next_heartbeat_seconds: z.number().int().positive().optional(),
});
export type ResponseCentral = z.infer<typeof responseSchema>;

export type ResultHeartbeat =
  | { ok: true; response: ResponseCentral }
  | { ok: false; result: Exclude<CentralResult, "ok">; http: number | null };

/** Formato de la llave que emite el central: `into_live_` + 32 letras y números. */
export const LICENSE_KEY_PATTERN = /^into_live_[0-9A-Za-z]{32}$/;

export async function sendHeartbeat(input: {
  url: string;
  key: string;
  body: BodyHeartbeat;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<ResultHeartbeat> {
  const { url, key: key, body: body, fetchImpl = fetch, timeoutMs = 10_000 } = input;
  let res: Response;
  try {
    res = await fetchImpl(`${url}/v1/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { ok: false, result: "sin_respuesta", http: null };
  }
  if (res.status === 401) return { ok: false, result: "llave_invalida", http: 401 };
  if (res.status === 429) return { ok: false, result: "limite", http: 429 };
  if (res.status === 400) return { ok: false, result: "rechazado", http: 400 };
  if (!res.ok) return { ok: false, result: "sin_respuesta", http: res.status };
  const parsed = responseSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) return { ok: false, result: "sin_respuesta", http: res.status };
  return { ok: true, response: parsed.data };
}

export const DEFAULT_INTERVAL_SECONDS = 900;

/** D5: lo que pide el central, acotado entre 1 minuto y 1 hora; sin dato, 15 min. */
export function nextInterval(request: number | null | undefined): number {
  if (!request || !Number.isFinite(request)) return DEFAULT_INTERVAL_SECONDS;
  return Math.min(3600, Math.max(60, Math.round(request)));
}
