import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { aiStatusOf, statusMessage } from "@/lib/ai/provider";

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
 */
export type NoticeIa = { message: string; action: string } | null;

export async function noticeIaOf(organizationId: string): Promise<NoticeIa> {
  const status = await aiStatusOf(organizationId);
  if (status.active) return null;

  const db = getDb();
  const rows = await db
    .select({ enabled: schema.agentProfile.enabled })
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  if (!rows[0]?.enabled) return null;

  const message = statusMessage(status);
  if (!message) return null;

  return {
    message: message,
    // Sin configurar se va a pegar la llave; pausada, a revisar la conexión.
    // Las dos acaban en la misma pantalla, y decirlo evita el «¿y dónde?».
    action:
      status.reason === "sin_configurar"
        ? "Configurar la IA"
        : "Revisar mi conexión",
  };
}
