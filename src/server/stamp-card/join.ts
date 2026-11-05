import { matchesJoinPhrase, renderJoinReply } from "@/lib/stamp-card";
import { logger } from "@/lib/observability/logger";
import { sendText } from "@/server/inbox/send";
import { ensureCard, publicCardUrl } from "./cards";
import { stampCardEnabled } from "./flag";
import { getProgram } from "./program";

/**
 * 1023, D4 — La frase de alta entra antes que el agente.
 *
 * Un WhatsApp entrante que coincide con la frase (sin mayúsculas, tildes ni
 * signos) crea o reutiliza la tarjeta del contacto y recibe la respuesta fija
 * con el enlace. Devuelve `true` si el mensaje era la frase: entonces ni el
 * agente ni el cerebro externo lo contestan. Corre después de guardar el
 * mensaje (bandeja primero) y dentro de la ventana que el cliente acaba de
 * abrir, así que no necesita plantilla (H2).
 *
 * Con la bandera apagada, sin programa o con el programa en pausa, devuelve
 * `false` y el mensaje sigue su camino normal.
 */
export async function handleJoinPhrase(input: {
  organizationId: string;
  contact: { id: string; name: string; channel: string };
  conversationId: string;
  text: string | null;
}): Promise<boolean> {
  if (!stampCardEnabled() || input.contact.channel !== "whatsapp" || !input.text) return false;
  const program = await getProgram(input.organizationId);
  if (!program || program.status !== "active" || !matchesJoinPhrase(input.text, program.joinPhrase)) return false;

  try {
    const { card } = await ensureCard(input.organizationId, input.contact.id, { source: "whatsapp" });
    const text = renderJoinReply(program.joinReply, {
      nombre: firstName(input.contact.name),
      negocio: program.name,
      enlace: publicCardUrl(card.id),
    });
    await sendText({ conversationId: input.conversationId, organizationId: input.organizationId, text });
  } catch (err) {
    // La tarjeta ya quedó (o no se pudo crear); lo que falló no tumba la
    // ingesta. El equipo ve el mensaje en la bandeja y puede responder a mano.
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), conversationId: input.conversationId },
      "[stamp-card] no se pudo responder la frase de alta"
    );
  }
  return true;
}

/** «Luz María Pérez» → «Luz»; un nombre vacío o que es un teléfono queda vacío. */
export function firstName(name: string): string {
  const trimmed = name.trim();
  if (/^\+?[\d\s().-]*$/.test(trimmed)) return "";
  return trimmed.split(/\s+/)[0] ?? "";
}
