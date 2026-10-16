import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { getEnv } from "@/lib/env";
import { isAiConfiguredFor } from "@/lib/ai/provider";
import { isBotKeyConfigured } from "@/server/bot/auth";
import {
  botLastSeenAt,
  computeBrainStatus,
  getBrainHealth,
} from "@/server/bot/status";
import { dispatchStatus } from "@/server/dispatch/status";

export const dynamic = "force-dynamic";

/**
 * «Quién responde a tus clientes»: el agente incluido, el cerebro externo,
 * el despacho (021) y el aviso de doble respuesta. Ver `server/bot/status.ts`.
 */
export const GET = withAuth(async (session) => {
  const db = getDb();
  const [rows, health, aiConfigured, dispatch] = await Promise.all([
    db
      .select({ enabled: schema.agentProfile.enabled })
      .from(schema.agentProfile)
      .where(scoped(schema.agentProfile.organizationId, session.organizationId))
      .limit(1),
    getBrainHealth(getEnv().BRAIN_HEALTH_URL),
    isAiConfiguredFor(session.organizationId),
    dispatchStatus(session.organizationId),
  ]);
  const status = computeBrainStatus({
    aiConfigured,
    agentEnabled: rows[0]?.enabled ?? false,
    botKeyConfigured: isBotKeyConfigured(),
    lastSeenAt: botLastSeenAt(),
    health,
    dispatch,
    now: new Date(),
  });
  return Response.json(status, { headers: { "cache-control": "no-store" } });
});
