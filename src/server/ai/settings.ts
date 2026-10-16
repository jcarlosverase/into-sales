import { z } from "zod";
import {
  AI_PROVIDERS,
  AI_PROVIDER_PRESETS,
  last4,
  type AiProviderId,
} from "@/lib/ai/presets";
import {
  envAiProvider,
  aiStatusOf,
  statusMessage,
  type AiStatus,
} from "@/lib/ai/provider";
import {
  getAiCredentialPublic,
  getAiCredentialSecret,
  type AiCredentialPublic,
} from "@/server/ai/credentials";

/**
 * Ajustes → IA: lo que valida y lo que devuelve `/api/settings/ai`. Fuera del
 * `route.ts` para poder probarlo sin sesión.
 */

const baseUrlSchema = z
  .string()
  .trim()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), {
    message: "La base URL debe empezar por http:// o https://",
  });

/**
 * El mínimo de la llave es laxo a propósito: el formato lo decide el proveedor
 * y cambia sin avisar. Quien manda sobre si sirve es el proveedor al usarla
 * («Probar conexión»).
 */
const tokenSchema = z.string().trim().min(8).max(4096);

const modelSchema = z.string().trim().min(1).max(200);

const withProvider = {
  // Sin `.default()`: con él, `parseBody` infiere el tipo de ENTRADA (con
  // `undefined`) y el handler pierde el tipado. La UI siempre lo manda.
  provider: z.enum(AI_PROVIDERS),
  /** Obligatoria con «Otro compatible con OpenAI»; con OpenRouter se ignora. */
  baseUrl: baseUrlSchema.optional(),
};

function requiresBaseUrl(
  data: { provider: AiProviderId; baseUrl?: string },
  ctx: z.RefinementCtx
) {
  if (data.provider === "openai_compatible" && !data.baseUrl) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["baseUrl"],
      message: "Con «Otro compatible con OpenAI» hay que indicar la base URL",
    });
  }
}

/** `PUT /api/settings/ai`: sin `token` solo cambia proveedor/modelo. */
export const aiSettingsPutSchema = z
  .object({
    ...withProvider,
    model: modelSchema,
    token: tokenSchema.optional(),
  })
  .superRefine(requiresBaseUrl);

/** `POST /api/settings/ai/test`: sin `token` se prueba la llave guardada. */
export const aiProbeSchema = z
  .object({
    ...withProvider,
    model: modelSchema,
    token: tokenSchema.optional(),
  })
  .superRefine(requiresBaseUrl);

/** `POST /api/settings/ai/models`: sin `token` se usa la llave guardada. */
export const aiModelsSchema = z
  .object({
    ...withProvider,
    token: tokenSchema.optional(),
  })
  .superRefine(requiresBaseUrl);

/** La base URL que de verdad se usa: la del preset, o la escrita. */
export function baseUrlEffective(
  provider: AiProviderId,
  baseUrl: string | undefined
): string {
  const preset = AI_PROVIDER_PRESETS[provider].baseUrl;
  if (preset) return preset;
  // El esquema ya exigió la base URL para este preset; el fallback solo
  // calma al tipado.
  return (baseUrl ?? "").trim().replace(/\/+$/, "");
}

/**
 * La llave con la que probar o listar: la escrita, o la guardada. `null` si
 * no hay ninguna de las dos.
 */
export async function keyForTest(
  organizationId: string,
  written: string | undefined
): Promise<{ token: string; saved: boolean } | null> {
  if (written) return { token: written, saved: false };
  const cred = await getAiCredentialSecret(organizationId);
  return cred ? { token: cred.token, saved: true } : null;
}

export type AiSettingsView = {
  credential: {
    provider: AiProviderId;
    baseUrl: string;
    model: string;
    tokenLast4: string;
    status: AiCredentialPublic["status"];
    reason: string | null;
    since: string | null;
    updatedAt: string;
  } | null;
  /** Lo que resuelve el adaptador ahora mismo (fila, y si no, entorno). */
  active: boolean;
  source: "org" | "env" | null;
  message: string | null;
  /** Las variables `OPENROUTER_*`, si están: el respaldo. */
  envFallback: { baseUrl: string; model: string; tokenLast4: string } | null;
};

export function credentialView(
  cred: AiCredentialPublic | null
): AiSettingsView["credential"] {
  if (!cred) return null;
  return {
    provider: cred.provider,
    baseUrl: cred.baseUrl,
    model: cred.model,
    tokenLast4: cred.tokenLast4,
    status: cred.status,
    reason: cred.statusReason,
    since: cred.statusChangedAt?.toISOString() ?? null,
    updatedAt: cred.updatedAt.toISOString(),
  };
}

export async function viewSettingsIa(
  organizationId: string
): Promise<AiSettingsView> {
  const [cred, status] = await Promise.all([
    getAiCredentialPublic(organizationId),
    aiStatusOf(organizationId),
  ]);
  return buildView(cred, status);
}

/** Pura, para las pruebas. */
export function buildView(
  cred: AiCredentialPublic | null,
  status: AiStatus
): AiSettingsView {
  const env = envAiProvider();
  return {
    credential: credentialView(cred),
    active: status.active,
    source: status.active ? status.source : null,
    message: statusMessage(status),
    envFallback: env
      ? { baseUrl: env.baseUrl, model: env.model, tokenLast4: last4(env.token) }
      : null,
  };
}
