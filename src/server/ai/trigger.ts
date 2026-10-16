import { scheduleAgentTurn } from "@/server/ai/pipeline";
import { isAiConfiguredFor } from "@/lib/ai/provider";
import { activeDispatch } from "@/server/brains/config";
import { dispatchToBrain } from "@/server/dispatch/enqueue";

/**
 * Punto de enganche del turno tras la ingesta de un mensaje entrante REAL (las
 * conversaciones del Laboratorio invocan el pipeline directamente, sin
 * debounce).
 *
 * 021 — Con un cerebro configurado (`BRAIN_DISPATCH_URL` + `BOT_API_KEY`) el
 * turno no se piensa aquí: se encola un despacho y el worker se lo entrega. Los
 * dos caminos son excluyentes: mientras el despacho está activo el agente
 * incluido no contesta, tenga o no proveedor de IA e interruptor encendido. Es
 * lo que evita la doble respuesta sin depender de que alguien se acuerde de
 * apagar uno.
 *
 * 025 — `messageId` es el entrante que provoca el turno. Quien lo lleve —el
 * despacho en su fila, el agente incluido en su coalesce— lo anota como algo
 * que DEBE: si el cliente escribe mientras se piensa la respuesta a lo
 * anterior, ese mensaje queda detrás de ella y sin la nota se da por atendido.
 */
export async function maybeRunAgentTurn(
  conversationId: string,
  organizationId: string,
  messageId: string
): Promise<void> {
  if (activeDispatch()) {
    await dispatchToBrain(conversationId, organizationId, messageId);
    return;
  }
  if (!(await isAiConfiguredFor(organizationId))) return;
  scheduleAgentTurn(conversationId, messageId);
}
