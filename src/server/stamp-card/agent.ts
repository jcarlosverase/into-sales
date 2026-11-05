import { stampCardContext } from "@/server/ai/prompts";
import { getCardForContact, publicCardUrl } from "./cards";
import { stampCardEnabled } from "./flag";
import { getProgram } from "./program";

/**
 * 1023, H7 — El contexto de la tarjeta para el turno del agente, o null sin
 * la bandera, sin programa o si el contacto no tiene tarjeta. Nunca frena el
 * turno: un fallo aquí deja al agente sin el dato, no sin responder.
 */
export async function stampCardContextFor(organizationId: string, contactId: string): Promise<string | null> {
  if (!stampCardEnabled()) return null;
  try {
    const [program, card] = await Promise.all([getProgram(organizationId), getCardForContact(organizationId, contactId)]);
    if (!program || !card) return null;
    return stampCardContext({
      programName: program.name,
      reward: program.reward,
      stamps: card.stamps,
      stampsRequired: card.stampsRequired,
      paused: program.status !== "active",
      url: publicCardUrl(card.id),
    });
  } catch {
    return null;
  }
}
