import { z } from "zod";
import { readConfigCentral } from "@/server/central/flag";
import { getKey } from "@/server/central/license";

/**
 * 1023, D8 — Cliente del contrato de wallet de into-central (spec 016,
 * `contracts/api.md`). Igual que el latido: la llave va solo en la cabecera y
 * ningún error lleva la llave ni la URL completa.
 *
 * El central firma con las cuentas de into; el CRM nunca le manda nombre,
 * teléfono ni conversaciones (AC11): cada cuerpo de aquí sale de funciones que
 * solo conocen el programa, los sellos y el serial.
 */

export type WalletErrorCode =
  | "off"
  | "no_key"
  | "invalid_api_key"
  | "wrong_product"
  | "plan_without_wallet"
  | "wrong_scope"
  | "missing_crm_url"
  | "unknown_class"
  | "invalid_request"
  | "rate_limited"
  | "upstream_error"
  | "wallet_unavailable"
  | "no_response";

const KNOWN: ReadonlySet<string> = new Set<WalletErrorCode>([
  "invalid_api_key",
  "wrong_product",
  "plan_without_wallet",
  "wrong_scope",
  "missing_crm_url",
  "unknown_class",
  "invalid_request",
  "rate_limited",
  "upstream_error",
  "wallet_unavailable",
]);

export class CentralWalletError extends Error {
  constructor(
    readonly code: WalletErrorCode,
    readonly http: number | null = null
  ) {
    super(`central wallet: ${code}${http ? ` (HTTP ${http})` : ""}`);
    this.name = "CentralWalletError";
  }

  /** ¿Vale la pena reintentar más tarde? (D9) */
  get transient(): boolean {
    return (
      this.code === "no_response" ||
      this.code === "upstream_error" ||
      this.code === "rate_limited" ||
      this.code === "wallet_unavailable"
    );
  }
}

const configSchema = z.object({
  scope: z.string().regex(/^c[a-z2-7]{8}$/),
  apple: z.object({
    enabled: z.boolean(),
    pass_type_id: z.string().regex(/^pass\.[A-Za-z0-9.-]+$/).optional(),
    team_id: z.string().regex(/^[A-Z0-9]{10}$/).optional(),
  }),
  google: z.object({ enabled: z.boolean(), issuer_id: z.string().optional() }),
});

export type WalletConfig = {
  scope: string;
  apple: { enabled: true; passTypeId: string; teamId: string } | { enabled: false };
  google: { enabled: true; issuerId: string } | { enabled: false };
};

type Options = { fetchImpl?: typeof fetch; timeoutMs?: number };

async function connection(organizationId: string): Promise<{ url: string; key: string }> {
  const config = readConfigCentral();
  if (!config.active) throw new CentralWalletError("off");
  const saved = await getKey(organizationId);
  if (!saved) throw new CentralWalletError("no_key");
  return { url: config.url, key: saved.key };
}

async function call<T>(
  organizationId: string,
  method: "GET" | "POST" | "PUT" | "PATCH",
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
  { fetchImpl = fetch, timeoutMs = 10_000 }: Options = {}
): Promise<T> {
  const { url, key } = await connection(organizationId);
  let res: Response;
  try {
    res = await fetchImpl(`${url}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch {
    throw new CentralWalletError("no_response");
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
    const code = data?.error?.code;
    throw new CentralWalletError(code && KNOWN.has(code) ? (code as WalletErrorCode) : "no_response", res.status);
  }
  const parsed = schema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new CentralWalletError("no_response", res.status);
  return parsed.data;
}

// ── Configuración, en caché (D9: el central caído no frena la página) ───────

const CONFIG_TTL_MS = 10 * 60_000;
const ERROR_TTL_MS = 60_000;

type Cached = { at: number; value: WalletConfig } | { at: number; error: CentralWalletError };
const cache = globalThis as unknown as { __walletConfigCache?: Map<string, Cached> };
function configCache(): Map<string, Cached> {
  cache.__walletConfigCache ??= new Map();
  return cache.__walletConfigCache;
}

/** Para pruebas y para cuando cambia la llave. */
export function clearWalletConfigCache(organizationId?: string): void {
  if (organizationId) configCache().delete(organizationId);
  else configCache().clear();
}

/** `GET /v1/wallet/config`: el prefijo del cliente y qué wallets firma el central. */
export async function getWalletConfig(organizationId: string, options: Options & { now?: number } = {}): Promise<WalletConfig> {
  const now = options.now ?? Date.now();
  const hit = configCache().get(organizationId);
  if (hit && now - hit.at < ("value" in hit ? CONFIG_TTL_MS : ERROR_TTL_MS)) {
    if ("value" in hit) return hit.value;
    throw hit.error;
  }
  try {
    const raw = await call(organizationId, "GET", "/v1/wallet/config", undefined, configSchema, options);
    const value: WalletConfig = {
      scope: raw.scope,
      apple:
        raw.apple.enabled && raw.apple.pass_type_id && raw.apple.team_id
          ? { enabled: true, passTypeId: raw.apple.pass_type_id, teamId: raw.apple.team_id }
          : { enabled: false },
      google: raw.google.enabled && raw.google.issuer_id ? { enabled: true, issuerId: raw.google.issuer_id } : { enabled: false },
    };
    configCache().set(organizationId, { at: now, value });
    return value;
  } catch (err) {
    const error = err instanceof CentralWalletError ? err : new CentralWalletError("no_response");
    // Sin central o sin llave no se guarda: se resuelve al configurarlos.
    if (error.code !== "off" && error.code !== "no_key") configCache().set(organizationId, { at: now, error });
    throw error;
  }
}

// ── Apple ────────────────────────────────────────────────────────────────────

/** `POST /v1/wallet/apple/sign`: el central firma el manifiesto, nunca ve el pase. */
export async function signAppleManifest(
  organizationId: string,
  serial: string,
  manifest: Buffer,
  options?: Options
): Promise<Buffer> {
  const out = await call(
    organizationId,
    "POST",
    "/v1/wallet/apple/sign",
    { serial, manifest: manifest.toString("base64") },
    z.object({ signature: z.string().min(1) }),
    options
  );
  return Buffer.from(out.signature, "base64");
}

/** `POST /v1/wallet/apple/push`: el aviso vacío a los dispositivos (hasta 100 por llamada). */
export async function pushApple(
  organizationId: string,
  pushTokens: string[],
  options?: Options
): Promise<{ sent: number; invalid: string[] }> {
  let sent = 0;
  const invalid: string[] = [];
  for (let i = 0; i < pushTokens.length; i += 100) {
    const out = await call(
      organizationId,
      "POST",
      "/v1/wallet/apple/push",
      { push_tokens: pushTokens.slice(i, i + 100) },
      z.object({ sent: z.number().int(), invalid: z.array(z.string()) }),
      options
    );
    sent += out.sent;
    invalid.push(...out.invalid);
  }
  return { sent, invalid };
}

// ── Google ───────────────────────────────────────────────────────────────────

type Image = { sourceUri: { uri: string } };
type TextModule = { id?: string; header: string; body: string };

type TemplateItem = { firstValue: { fields: { fieldPath: string }[] } };
type CardRow =
  | { oneItem: { item: TemplateItem } }
  | { twoItems: { startItem: TemplateItem; endItem: TemplateItem } }
  | { threeItems: { startItem: TemplateItem; middleItem: TemplateItem; endItem: TemplateItem } };

export type GoogleClassBody = {
  programName: string;
  programLogo: Image;
  heroImage?: Image;
  hexBackgroundColor?: string;
  textModulesData?: TextModule[];
  /** Filas en el frente de la tarjeta, arriba del QR (central 016, contrato). */
  classTemplateInfo?: { cardTemplateOverride: { cardRowTemplateInfos: CardRow[] } };
};

export type GoogleObjectBody = {
  loyaltyPoints: { label: string; balance: { int: number } };
  barcode: { type: "QR_CODE"; value: string; alternateText?: string };
  heroImage?: Image;
  hexBackgroundColor?: string;
  textModulesData?: TextModule[];
};

/** `PUT /v1/wallet/google/classes/{suffix}`: crea o actualiza la clase (idempotente por versión). */
export async function putGoogleClass(
  organizationId: string,
  classSuffix: string,
  version: number,
  body: GoogleClassBody,
  options?: Options
): Promise<{ id: string; version: number }> {
  return call(
    organizationId,
    "PUT",
    `/v1/wallet/google/classes/${encodeURIComponent(classSuffix)}`,
    { version, class: body },
    z.object({ id: z.string(), version: z.number().int() }),
    options
  );
}

/** `POST /v1/wallet/google/save-link`: el enlace «Guardar en Google Wallet». */
export async function googleSaveLink(
  organizationId: string,
  input: { classSuffix: string; objectSuffix: string; object: GoogleObjectBody },
  options?: Options
): Promise<string> {
  const out = await call(
    organizationId,
    "POST",
    "/v1/wallet/google/save-link",
    { class_suffix: input.classSuffix, object_suffix: input.objectSuffix, object: input.object },
    z.object({ url: z.string().url() }),
    options
  );
  return out.url;
}

/** `PATCH /v1/wallet/google/objects/{suffix}`: los sellos de una tarjeta ya guardada. */
export async function patchGoogleObject(
  organizationId: string,
  objectSuffix: string,
  input: { version: number; loyaltyPoints: number; pointsLabel: string; message?: { header: string; body: string } },
  options?: Options
): Promise<{ version: number; saved: boolean }> {
  return call(
    organizationId,
    "PATCH",
    `/v1/wallet/google/objects/${encodeURIComponent(objectSuffix)}`,
    {
      version: input.version,
      loyalty_points: input.loyaltyPoints,
      points_label: input.pointsLabel,
      ...(input.message ? { message: input.message } : {}),
    },
    z.object({ version: z.number().int(), saved: z.boolean() }),
    options
  );
}
