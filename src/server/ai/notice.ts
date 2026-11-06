import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { aiStatusOf, blockedMessage, statusMessage } from "@/lib/ai/provider";
import { getAiCredentialPublic } from "@/server/ai/credentials";

/**
 * ¿Hay que avisarle al dueño de que su agente no puede contestar?
 * (puerto de `aviso-ia` de Vocero Cloud, issue #85)
 *
 * El caso que esto cierra: una organización con el agente encendido y sin
 * proveedor de IA (o con la llave rechazada). El mensaje entra, el turno no
 * tiene con qué pensar y la conversación se queda en la bandeja. Desde fuera
 * se ve exactamente igual que un bot roto — y el único sitio donde se
 * explicaba era un recuadro dentro del panel de UN contacto.
 *
 * Se exige que el agente esté ENCENDIDO: sin IA y con el agente apagado no
 * hay nada que avisar. Lo que se señala es la contradicción.
 *
 * 1027 — También con la llave activa, si el proveedor está frenando los
 * pedidos (403 o cupo agotado): por fuera se ve igual que un bot roto.
 */
export type NoticeIa = { message: string; action: string } | null;

export async function noticeIaOf(organizationId: string): Promise<NoticeIa> {
  const status = await aiStatusOf(organizationId);
  const blocked = status.active ? (await getAiCredentialPublic(organizationId))?.blockedReason ?? null : null;
  if (status.active && !blocked) return null;

  const db = getDb();
  const rows = await db
    .select({ enabled: schema.agentProfile.enabled })
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  if (!rows[0]?.enabled) return null;

  if (blocked) return { message: blockedMessage(blocked), action: "Revisar mi conexión" };

  const message = statusMessage(status);
  if (!message) return null;

  return {
    message: message,
    // Sin configurar se va a pegar la llave; pausada, a revisar la conexión.
    // Las dos acaban en la misma pantalla, y decirlo evita el «¿y dónde?».
    action:
      !status.active && status.reason === "sin_configurar"
        ? "Configurar la IA"
        : "Revisar mi conexión",
  };
}
