import { checkDispatch, checkWhatsApp, type CheckResult } from "@/server/doctor/checks";
import { aiStatusOf } from "@/lib/ai/provider";
import { mediaDirStatus } from "@/server/media-dir";
import type { CheckId, CheckStatus } from "@/server/central/client";

/**
 * 028, D3 — Los cinco chequeos del latido, con las MISMAS funciones del
 * doctor. Solo viaja el estado: el detalle (teléfonos, motivos, rutas) se
 * queda en el CRM (contrato del central; su Principio II, «Mínimo dato»).
 */

const WORST: CheckStatus[] = ["fail", "warn", "ok", "skip"];

/** Con varios números de WhatsApp, cuenta el peor. */
export function worstStatus(statuses: CheckStatus[]): CheckStatus {
  for (const e of WORST) if (statuses.includes(e)) return e;
  return "skip";
}

export type DependenciesChecks = {
  mediaDir?: () => Promise<{ writable: boolean } | null>;
  whatsapp?: () => Promise<CheckResult[]>;
  ia?: (organizationId: string) => Promise<{ active: boolean; reason?: string }>;
  dispatch?: () => CheckResult;
};

/**
 * Nunca lanza: un chequeo que no se pudo correr va como `warn`, porque el
 * latido tiene que salir igual (D4).
 */
export async function heartbeatChecks(
  organizationId: string,
  deps: DependenciesChecks = {}
): Promise<{ id: CheckId; status: CheckStatus }[]> {
  const mediaDir = deps.mediaDir ?? mediaDirStatus;
  const whatsapp = deps.whatsapp ?? (() => checkWhatsApp());
  const ia = deps.ia ?? aiStatusOf;
  const dispatch = deps.dispatch ?? (() => checkDispatch(process.env));

  const safe = async (f: () => Promise<CheckStatus>): Promise<CheckStatus> => {
    try {
      return await f();
    } catch {
      return "warn";
    }
  };

  return [
    // El latido acaba de leer la llave de la base: si llegó aquí, responde.
    { id: "database", status: "ok" },
    {
      id: "media_dir",
      status: await safe(async () => {
        const media = await mediaDir();
        return media ? (media.writable ? "ok" : "fail") : "skip";
      }),
    },
    { id: "whatsapp", status: await safe(async () => worstStatus((await whatsapp()).map((r) => r.status))) },
    {
      id: "ai",
      status: await safe(async () => {
        const status = await ia(organizationId);
        if (status.active) return "ok";
        return status.reason === "sin_configurar" ? "skip" : "fail";
      }),
    },
    { id: "dispatch", status: await safe(async () => dispatch().status) },
  ];
}
