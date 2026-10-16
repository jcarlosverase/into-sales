import { requireSession, UnauthorizedError } from "@/lib/auth/session";
import { subscribe, type SseEvent } from "@/server/events/bus";
import {
  canSeeConversation,
  getLeadScope,
  type LeadScope,
} from "@/server/leads/scope";

/**
 * 022 — The conversation an event is about, if any. Events without one
 * (bookings, Lab runs) are not filtered by lead ownership.
 */
function conversationIdOf(event: SseEvent): string | null {
  switch (event.type) {
    case "message.new":
    case "message.status":
      return event.data.conversationId;
    case "conversation.updated": {
      const conversation = event.data.conversation as { id?: unknown } | null;
      return typeof conversation?.id === "string" ? conversation.id : null;
    }
    default:
      return null;
  }
}

async function canReceive(
  scope: LeadScope,
  organizationId: string,
  event: SseEvent
): Promise<boolean> {
  if (scope.kind === "all") return true;
  const conversationId = conversationIdOf(event);
  if (!conversationId) return true;
  return canSeeConversation(scope, organizationId, conversationId);
}

/**
 * Canal SSE de la bandeja (contrato sse.md).
 * Headers exactos + heartbeat ~25s para sobrevivir detrás de Caddy/Traefik.
 * El servidor no garantiza replay: el cliente hace catch-up con `since=`.
 */
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;
const encoder = new TextEncoder();

export async function GET(req: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return new Response("No autenticado", { status: 401 });
    }
    throw err;
  }
  const { organizationId } = session;
  const scope = getLeadScope(session);

  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup?.();
        }
      };

      send(`: conectado\n\n`);

      const write = (event: SseEvent) =>
        send(
          `event: ${event.type}\n` +
            `id: ${Date.now()}\n` +
            `data: ${JSON.stringify(event.data)}\n\n`
        );

      // 022 — For a sales rep each event is checked against their leads.
      // The checks are chained so events still arrive in publish order (a
      // message's status must not overtake the message itself).
      let queue: Promise<void> = Promise.resolve();
      const unsubscribe = subscribe(organizationId, (event) => {
        if (scope.kind === "all") {
          write(event);
          return;
        }
        queue = queue
          .then(async () => {
            if (await canReceive(scope, organizationId, event)) write(event);
          })
          .catch((err) => console.error("[sse] filter failed:", err));
      });

      const heartbeat = setInterval(() => send(`: ping\n\n`), HEARTBEAT_MS);

      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // ya cerrado
        }
      };

      req.signal.addEventListener("abort", () => cleanup?.());
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
