import { JUDGE_MARKER } from "@/server/ai/prompts";
import { HEADER_SLOTS } from "@/server/agenda/offers";

/**
 * Proveedor LLM determinista para el self-test (contrato mocks.md).
 * Despacha por contenido del último mensaje `user` (o del system si es el
 * juez). JAMÁS es fallback en runtime: solo responde si OPENROUTER_BASE_URL
 * apunta explícitamente a él y el gate de mocks está activo.
 */

type InMessage = { role: string; content: string };

/**
 * Sufijos de la llave que el mock rechaza, con el código que daría el
 * proveedor real: `-invalid` → 401 (llave rechazada) y `-sin-saldo` → 402.
 * Es lo que permite ejercitar la pausa de Ajustes → IA en el self-test sin
 * un proveedor de verdad. Cualquier otra llave se acepta.
 */
export function aiMockAuthFailure(
  authorization: string | null
): { status: 401 | 402; body: { error: { message: string } } } | null {
  const token = (authorization ?? "").replace(/^Bearer\s+/i, "").trim();
  if (token.endsWith("-invalid")) {
    return { status: 401, body: { error: { message: "Invalid API key (mock)" } } };
  }
  if (token.endsWith("-sin-saldo")) {
    return {
      status: 402,
      body: { error: { message: "Insufficient credits (mock)" } },
    };
  }
  return null;
}

/** La lista de `GET /v1/models` del mock: suficiente para «Traer modelos». */
export function aiMockModels(): { id: string; name: string }[] {
  return [
    { id: "mock/agente", name: "Modelo de prueba (agente)" },
    { id: "mock/juez", name: "Modelo de prueba (juez)" },
  ];
}

/**
 * 025 — Lo que el guion necesita para probar el turno del agente incluido.
 *
 * `demoraMs` hace que el modelo «piense»: es lo que deja meter un mensaje con
 * el turno en curso. Y se guarda lo que se le preguntó, porque la respuesta
 * sola no dice en qué ORDEN leyó la conversación — y ese orden es justo lo que
 * decide si atiende el mensaje que entró mientras pensaba.
 */
type Request = { at: string; messages: InMessage[] };
type AiStatus = { delayMs: number; requests: Request[] };

const globalForIa = globalThis as unknown as { __voceroAiMock?: AiStatus };

function aiStatus(): AiStatus {
  globalForIa.__voceroAiMock ??= { delayMs: 0, requests: [] };
  return globalForIa.__voceroAiMock;
}

/** Consulta o configura el mock: `?demoraMs=3000`, `?reset=1`. */
export function aiMockStatus(params: URLSearchParams): AiStatus {
  const e = aiStatus();
  const delayMs = params.get("demoraMs");
  if (delayMs !== null) {
    e.delayMs = Math.min(Math.max(Number(delayMs) || 0, 0), 60_000);
  }
  if (params.get("reset") === "1") e.requests = [];
  return e;
}

/**
 * Anota la petición y espera lo configurado. El juez del Laboratorio no se
 * anota ni se demora: lo que se observa es la charla con el cliente.
 */
export async function aiMockRegister(messages: InMessage[]): Promise<void> {
  if (messages.some((m) => m.role === "system" && m.content.includes(JUDGE_MARKER))) {
    return;
  }
  const e = aiStatus();
  // Sin el prompt de sistema: es largo, y lo que se comprueba es la charla.
  e.requests.push({
    at: new Date().toISOString(),
    messages: messages.filter((m) => m.role !== "system"),
  });
  if (e.requests.length > 50) e.requests.shift();
  if (e.delayMs > 0) await new Promise((r) => setTimeout(r, e.delayMs));
}

export function aiMockCompletion(messages: InMessage[]): string {
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const lastUser =
    [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

  // Juez del Laboratorio: veredicto determinista por persona. Para cerrar el
  // loop del self-test, la persona fuera_de_kb pasa a verde si el CONOCIMIENTO
  // configurado ya cubre garantías/devoluciones (sugerencia aplicada).
  if (system.includes(JUDGE_MARKER)) {
    const kbSection =
      lastUser
        .split("CONOCIMIENTO CONFIGURADO:")[1]
        ?.split("TRANSCRIPT COMPLETO:")[0] ?? "";
    const kbCoversWarranty = /garant|devoluc/i.test(kbSection);
    if (lastUser.includes("fuera_de_kb") && !kbCoversWarranty) {
      return JSON.stringify({
        veredicto: "rojo",
        hallazgos: [
          {
            tipo: "fuera_de_kb",
            evidencia:
              "El cliente preguntó por garantías y devoluciones y el conocimiento no lo cubre.",
            sugerencia: {
              pregunta: "¿Cuál es la política de garantías y devoluciones?",
              respuesta:
                "Aceptamos devoluciones dentro de los 30 días con ticket de compra; la garantía depende del fabricante.",
            },
          },
        ],
      });
    }
    return JSON.stringify({ veredicto: "verde", hallazgos: [] });
  }

  const text = lastUser.toLowerCase();

  /**
   * 015 — La agenda, ejercitando el camino REAL.
   *
   * El mock reserva copiando el `startUtc` del mapa de huecos, igual que tiene
   * que hacer un modelo de verdad. Si ese mapa deja de llegar, aquí no hay de
   * dónde sacar el instante y la reserva falla — que es exactamente el fallo
   * que se vivió en producción (#50), en vez de un test que lo simula.
   *
   * Se buscan TODOS los mensajes `system`, no solo el primero: el mapa va al
   * final, después del historial.
   */
  const slots = messages
    .filter((m) => m.role === "system" && m.content.includes(HEADER_SLOTS))
    .flatMap((m) => m.content.match(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g) ?? []);

  /**
   * Solo ofrece horarios si el prompt le ENSEÑÓ `offer_slots`, como un modelo
   * real. Con la agenda apagada el prompt no la trae (ni el esquema del turno
   * la acepta), y el mock la contestaba igual: la conversación acababa en
   * "Error del proveedor de IA", algo que en producción no pasa (R11).
   */
  const agendaTaught = messages.some(
    (m) => m.role === "system" && m.content.includes('"action":"offer_slots"')
  );
  const wantsBooking = /cita|agendar|agenda|horario|reserv/.test(text);
  if (agendaTaught && wantsBooking && slots.length === 0) {
    return JSON.stringify({
      action: "offer_slots",
      reply: "Claro, tengo estos horarios:",
    });
  }
  const pickOne = /primero|segundo|ese|esa|confirmo|quiero|me sirve/.test(text);
  if (slots.length > 0 && pickOne) {
    return JSON.stringify({
      action: "book_slot",
      startUtc: slots[0],
      reply: "¡Listo! Te agendé.",
    });
  }

  // Persona pide_humano (el regex de respaldo captura la frase canónica; esta
  // rama cubre variantes que llegan al modelo).
  if (text.includes("humano") || text.includes("asesor")) {
    return JSON.stringify({ action: "handoff", reason: "cliente" });
  }

  // Intención de compra → mover a Interesado.
  if (
    text.includes("lo compro") ||
    text.includes("quiero comprar") ||
    text.includes("me lo llevo")
  ) {
    return JSON.stringify({
      action: "move_stage",
      stage: "Interesado",
      reply: "¡Excelente! Te aparto el producto y un compañero te confirma el pago.",
    });
  }

  const echo = lastUser.slice(0, 80);
  return JSON.stringify({
    action: "reply",
    text: `Respuesta de prueba sobre: ${echo}`,
  });
}
